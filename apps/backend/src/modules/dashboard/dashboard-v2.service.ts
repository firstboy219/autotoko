import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { PendingTasksService } from "./pending-tasks.service.js";

/**
 * Angka untuk Dashboard v2.
 *
 * KENAPA ADA. Dashboard lama dibangun di sekitar model "order dan revenue":
 * order hari ini, omzet hari ini, tren order tujuh hari, tabel order terbaru.
 * Toko ini tidak memakai satu pun dari itu -- tabel orders berisi 16 baris uji
 * dan today_orders selalu 0. Jadi ruang paling berharga di layar menampilkan
 * nol selamanya, sementara uang yang sebenarnya bergerak lewat pencairan dan
 * paket yang sebenarnya dikirim lewat scan resi tidak muncul di sana.
 *
 * Yang dihitung di sini adalah pertanyaan yang benar-benar ditanyakan pemilik
 * toko: berapa yang masuk, berapa yang jadi milik saya, dari toko mana, apa
 * yang harus dikerjakan hari ini, dan -- yang paling sering hilang dari
 * dashboard mana pun -- seberapa boleh saya percaya angka-angka ini.
 *
 * Dihitung di server, bukan di layar: satu perjalanan, dan angka yang sama
 * untuk semua yang membacanya. Dashboard lama tidak disentuh sama sekali.
 */
@Injectable()
export class DashboardV2Service {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly pending: PendingTasksService,
  ) {}

  async overview(userId: string, from: string, to: string) {
    const hari = Math.max(
      1,
      Math.round(
        (new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) /
          86400000,
      ) + 1,
    );
    // Periode pembanding: sama panjang, tepat sebelum periode ini. Delta tanpa
    // pembanding yang sama panjang adalah angka yang tidak berarti apa-apa.
    const sebelumTo = new Date(new Date(from + "T00:00:00Z").getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    const sebelumFrom = new Date(
      new Date(from + "T00:00:00Z").getTime() - hari * 86400000,
    )
      .toISOString()
      .slice(0, 10);

    const [uang, uangSebelum, volume, volumeSebelum, seri, toko, produk, keandalan, tugas] =
      await Promise.all([
        this.uang(userId, from, to),
        this.uang(userId, sebelumFrom, sebelumTo),
        this.volume(userId, from, to),
        this.volume(userId, sebelumFrom, sebelumTo),
        this.seri(userId, from, to),
        this.perToko(userId, from, to),
        this.produkTeratas(userId, from, to),
        this.keandalan(userId, from, to),
        this.pending.list(userId),
      ]);

    const kredit = uang.kredit;
    return {
      range: { from, to, hari, bandingFrom: sebelumFrom, bandingTo: sebelumTo },
      uang: {
        ...uang,
        // Berapa persen dari uang yang cair benar-benar tinggal di pemiliknya.
        // Satu angka yang menjawab "usaha ini sebenarnya menghasilkan berapa".
        rateEfektif: kredit > 0 ? uang.sellerBersih / kredit : 0,
        perHari: kredit / hari,
      },
      banding: {
        kredit: uangSebelum.kredit,
        sellerBersih: uangSebelum.sellerBersih,
        paket: volumeSebelum.paket,
      },
      volume: { ...volume, perHari: volume.paket / hari },
      seri,
      toko,
      produk,
      keandalan,
      tindakan: {
        total: tugas.total,
        tinggi: tugas.highCount,
        tugas: tugas.tasks.map((t) => ({
          key: t.key,
          title: t.title,
          count: t.count,
          severity: t.severity,
          href: t.href,
        })),
      },
    };
  }

  /** Pembagian uang yang cair pada satu rentang. */
  private async uang(userId: string, from: string, to: string) {
    const rows = await this.db.execute(sql`
      select coalesce(sum(credit_amount), 0)::float8 as kredit,
             coalesce(sum(sedekah_amount), 0)::float8 as sedekah,
             coalesce(sum(seller_amount), 0)::float8 as seller,
             coalesce(sum(seller_material_amount), 0)::float8 as bahan_baku,
             coalesce(sum(coalesce(sub_seller_amount, 0)
                        + coalesce(sub_sub_seller_amount, 0)), 0)::float8 as sub_seller,
             count(*)::int as baris
        from payout_mutations
       where user_id = ${userId}
         and payout_date between ${from}::date and ${to}::date
    `);
    const r = (rows as unknown as Record<string, unknown>[])[0] ?? {};

    const n = (v: unknown) => Number(v ?? 0);
    const seller = n(r.seller);
    const bahanBaku = n(r.bahan_baku);
    return {
      kredit: n(r.kredit),
      sedekah: n(r.sedekah),
      subSeller: n(r.sub_seller),
      bahanBaku,
      // Bagian seller SUDAH dikurangi jatah bahan baku. Menyebut yang kotor
      // sebagai "bagian saya" adalah cara paling halus sebuah dashboard
      // berbohong: uangnya nyata, tapi separuhnya sudah punya tujuan.
      sellerBersih: seller - bahanBaku,
      sellerKotor: seller,
      pencairan: Number(r.baris ?? 0),
    };
  }

  /**
   * Paket dan pcs yang benar-benar keluar.
   *
   * Tiga kueri terpisah, bukan satu dengan subkueri bersarang di dalam
   * agregat: yang terakhir itu tidak sah di Postgres, dan menyatukannya hanya
   * menghemat satu perjalanan yang tidak pernah jadi masalah.
   */
  private async volume(userId: string, from: string, to: string) {
    const paketRows = await this.db.execute(sql`
      select count(*)::int as paket, count(distinct shop_id)::int as toko
        from resi_scans
       where user_id = ${userId}
         and scanned_at >= ${from + " 00:00:00"}::timestamptz
         and scanned_at <= ${to + " 23:59:59"}::timestamptz
    `);
    const pcsRows = await this.db.execute(sql`
      select coalesce(sum(i.qty), 0)::float8 as pcs
        from resi_scan_items i
        join resi_scans s on s.id = i.resi_scan_id
       where s.user_id = ${userId}
         and s.scanned_at >= ${from + " 00:00:00"}::timestamptz
         and s.scanned_at <= ${to + " 23:59:59"}::timestamptz
    `);
    const tokoRows = await this.db.execute(sql`
      select count(*)::int as n from shops where user_id = ${userId}
    `);

    const a = (rows: unknown) => (rows as Record<string, unknown>[])[0] ?? {};
    const p = a(paketRows);
    return {
      paket: Number(p.paket ?? 0),
      pcs: Number(a(pcsRows).pcs ?? 0),
      tokoAktif: Number(p.toko ?? 0),
      tokoTotal: Number(a(tokoRows).n ?? 0),
    };
  }

  /**
   * Deret harian: uang yang cair dan paket yang keluar.
   *
   * Hari tanpa kejadian tetap muncul sebagai nol, bukan hilang dari deret.
   * Garis yang melompati hari kosong membuat jeda terlihat seperti kesinambungan.
   */
  private async seri(userId: string, from: string, to: string) {
    const rows = await this.db.execute(sql`
      with hari as (
        select generate_series(${from}::date, ${to}::date, interval '1 day')::date as tanggal
      ),
      cair as (
        select payout_date as tanggal, sum(credit_amount) as kredit
          from payout_mutations
         where user_id = ${userId} and payout_date between ${from}::date and ${to}::date
         group by 1
      ),
      kirim as (
        select (scanned_at at time zone 'Asia/Jakarta')::date as tanggal, count(*) as paket
          from resi_scans
         where user_id = ${userId}
           and scanned_at >= ${from + " 00:00:00"}::timestamptz
           and scanned_at <= ${to + " 23:59:59"}::timestamptz
         group by 1
      )
      select h.tanggal::text as tanggal,
             coalesce(c.kredit, 0)::float8 as kredit,
             coalesce(k.paket, 0)::int as paket
        from hari h
        left join cair c on c.tanggal = h.tanggal
        left join kirim k on k.tanggal = h.tanggal
       order by h.tanggal
    `);
    return (rows as unknown as { tanggal: string; kredit: number; paket: number }[]).map(
      (r) => ({ tanggal: r.tanggal, kredit: Number(r.kredit), paket: Number(r.paket) }),
    );
  }

  /** Kontribusi tiap toko, diurut dari yang terbesar. */
  private async perToko(userId: string, from: string, to: string) {
    const rows = await this.db.execute(sql`
      select sh.id,
             coalesce(nullif(sh.display_name, ''), sh.shop_name, '(tanpa nama)') as nama,
             sh.marketplace::text as marketplace,
             coalesce(sum(m.credit_amount), 0)::float8 as kredit,
             coalesce(sum(m.seller_amount - coalesce(m.seller_material_amount, 0)), 0)::float8
               as seller_bersih,
             (select count(*)::int from resi_scans s
               where s.shop_id = sh.id
                 and s.scanned_at >= ${from + " 00:00:00"}::timestamptz
                 and s.scanned_at <= ${to + " 23:59:59"}::timestamptz) as paket
        from shops sh
        left join payout_mutations m
               on m.shop_id = sh.id
              and m.payout_date between ${from}::date and ${to}::date
       where sh.user_id = ${userId}
       group by sh.id, nama, sh.marketplace
       order by kredit desc
    `);
    return (rows as unknown as Record<string, unknown>[])
      .map((r) => ({
        id: String(r.id),
        nama: String(r.nama),
        marketplace: String(r.marketplace ?? "-"),
        kredit: Number(r.kredit ?? 0),
        sellerBersih: Number(r.seller_bersih ?? 0),
        paket: Number(r.paket ?? 0),
      }))
      // Toko yang tidak bergerak sama sekali pada periode ini tidak
      // menceritakan apa pun selain panjangnya daftar.
      .filter((r) => r.kredit > 0 || r.paket > 0);
  }

  /** Produk yang paling banyak keluar, dihitung dari isi paket. */
  private async produkTeratas(userId: string, from: string, to: string) {
    const rows = await this.db.execute(sql`
      select p.id,
             p.name as nama,
             sum(i.qty)::float8 as pcs,
             count(distinct s.id)::int as paket
        from resi_scan_items i
        join resi_scans s on s.id = i.resi_scan_id
        join master_products p on p.id = i.master_product_id
       where s.user_id = ${userId}
         and s.scanned_at >= ${from + " 00:00:00"}::timestamptz
         and s.scanned_at <= ${to + " 23:59:59"}::timestamptz
       group by p.id, p.name
       order by pcs desc
       limit 8
    `);
    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      nama: String(r.nama),
      pcs: Number(r.pcs ?? 0),
      paket: Number(r.paket ?? 0),
    }));
  }

  /**
   * Seberapa boleh angka di atas dipercaya.
   *
   * Bagian yang hampir selalu hilang dari dashboard, dan justru yang paling
   * menentukan: sebuah grafik per toko yang rapi tidak ada gunanya kalau
   * separuh paketnya tidak terpetakan ke toko mana pun. Ditampilkan sebagai
   * angka, bukan disembunyikan sebagai catatan kaki.
   */
  private async keandalan(userId: string, from: string, to: string) {
    const rows = await this.db.execute(sql`
      select count(*)::int as scan,
             count(shop_id)::int as ber_toko,
             -- Bentuk yang sama dengan pengesah order id: 18 digit murni.
             -- Sisanya kode sortir kurir dan nomor pengiriman, yang tidak bisa
             -- dipasangkan dengan laporan marketplace mana pun.
             count(*) filter (where label_order_no ~ '^[0-9]{18}$')::int as ber_order_id,
             count(items_confirmed_at)::int as isi_pasti
        from resi_scans
       where user_id = ${userId}
         and scanned_at >= ${from + " 00:00:00"}::timestamptz
         and scanned_at <= ${to + " 23:59:59"}::timestamptz
    `);
    const r = (rows as unknown as Record<string, unknown>[])[0] ?? {};
    const scan = Number(r.scan ?? 0);
    const bagi = (n: number) => (scan > 0 ? n / scan : 0);
    return {
      scan,
      berToko: Number(r.ber_toko ?? 0),
      berOrderId: Number(r.ber_order_id ?? 0),
      isiPasti: Number(r.isi_pasti ?? 0),
      persenToko: bagi(Number(r.ber_toko ?? 0)),
      persenOrderId: bagi(Number(r.ber_order_id ?? 0)),
      persenIsi: bagi(Number(r.isi_pasti ?? 0)),
    };
  }
}
