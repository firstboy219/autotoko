/**
 * Berapa persen sebenarnya yang dipotong marketplace, dihitung dari laporannya.
 *
 * KENAPA PERLU. Kolom "Biaya Marketplace" di HPP berisi angka yang diketik
 * sendiri, dan bawaannya 15%. Diukur pada laporan penyelesaian sungguhan toko
 * ini, yang benar-benar dipotong 42,0% untuk pesanan TikTok Shop dan 35,7%
 * untuk Tokopedia. Selisih dua puluh tujuh angka persen itu masuk seluruhnya
 * ke perhitungan margin, dan produk yang terlihat untung di layar bisa merugi
 * di rekening.
 *
 * DARI MANA ANGKANYA. Tiap baris pesanan di laporan membawa tiga hal: "Total
 * Pendapatan" (harga yang dibayar pembeli), "Total Biaya" (yang ditahan
 * marketplace), dan "Jumlah penyelesaian pembayaran" (yang benar-benar cair).
 * Persentasenya adalah biaya dibagi pendapatan -- tidak disimpulkan dari
 * selisih apa pun, melainkan dibaca dari angka yang ditulis marketplace-nya
 * sendiri.
 *
 * DUA ANGKA, dan bedanya penting:
 *
 *   tertimbang -- seluruh biaya dibagi seluruh pendapatan. Ini yang benar
 *                 untuk menjawab "berapa uang saya yang hilang".
 *   median     -- persentase pesanan yang di tengah. Ini yang benar untuk
 *                 menyetel biaya SATU produk, karena satu pesanan besar
 *                 dengan biaya tak lazim tidak menyeretnya.
 *
 * Yang disarankan ke kolom HPP adalah median, dan yang tertimbang tetap
 * ditampilkan di sebelahnya. Menyembunyikan salah satunya berarti memilihkan
 * kesimpulan tanpa memperlihatkan dasarnya.
 */

import {
  uraikanDetailProduk,
  cocokkanKeKatalog,
  type ItemProdukPesanan,
  type PetaSku,
} from "./detail-produk";

export interface BarisPesanan {
  /** Isi kolom mentah satu baris laporan. */
  raw: unknown;
  namaToko: string | null;
  marketplace: string | null;
  periodeDari: string | Date | null;
  periodeSampai: string | Date | null;
  /** Pengayaan opsional dari join ke tabel orders (sumber API): tanggal cair
   *  (occurred_on), tanggal order, status scan, dan daftar item order. */
  tanggalCair?: string | null;
  tanggalOrder?: string | null;
  discan?: boolean | null;
  /** Tanggal mulai delivery (collection/rts) "YYYY-MM-DD" dari orders.raw. */
  tanggalDelivery?: string | null;
  itemsOrder?: Array<{ name?: string; skuName?: string; skuId?: string; qty?: number }> | null;
}

export interface RingkasanBiaya {
  toko: string;
  /** "TikTok Shop" / "Tokopedia" — dari kolom "Sumber pesanan" di laporan. */
  sumber: string;
  pesanan: number;
  pendapatan: number;
  biaya: number;
  /** Seluruh biaya dibagi seluruh pendapatan. */
  persenTertimbang: number;
  /** Persentase pesanan yang di tengah. Inilah yang disarankan. */
  persenMedian: number;
  persenTerendah: number;
  persenTertinggi: number;
  dari: string;
  sampai: string;
}

/** Angka dari teks laporan: "-14.659" dan "-14659" sama-sama harus terbaca. */
export function angka(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v ?? "").replace(/[^0-9.,-]/g, "");
  if (!t) return 0;
  // Titik sebagai pemisah ribuan, koma sebagai desimal (format Indonesia).
  const bersih = t.replace(/\./g, "").replace(",", ".");
  const n = Number(bersih);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Satu baris pesanan bisa datang dari DUA sumber dengan nama kolom berbeda:
 *  - unggahan laporan Excel TikTok (kolom bahasa Indonesia), atau
 *  - API Finance TikTok (source='api', kunci snake_case).
 * Fungsi ini menyeragamkannya jadi field kanonik yang dipakai audit, sehingga
 * tabel "Potongan marketplace per pesanan" terisi untuk kedua sumber.
 *
 * Untuk baris API: pendapatan = revenue_amount, cair = settlement_amount, dan
 * yang dipotong = pendapatan - cair (konsisten dengan kolom "Total Biaya"
 * laporan; revenue - fee = settlement pada data TikTok).
 */
export interface BarisKanonik {
  orderNo: string;
  pendapatan: number;
  biaya: number;
  cair: number;
  sumber: string;
  tanggal: string;
  detailProduk: unknown;
}

export function bacaBaris(r: Record<string, unknown>, marketplaceFallback: string): BarisKanonik {
  const mp = (marketplaceFallback ?? "").trim();
  // Format API: dikenali dari settlement_amount / order_id.
  if (r["settlement_amount"] !== undefined || r["order_id"] !== undefined) {
    const pendapatan = angka(r["revenue_amount"] ?? r["net_sales_amount"] ?? r["gross_sales_amount"] ?? r["customer_payment_amount"]);
    const cair = angka(r["settlement_amount"]);
    const biaya = Math.max(0, pendapatan - cair);
    const t = Number(r["order_create_time"] ?? r["statement_time"]);
    const tanggal = Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString().slice(0, 10) : "";
    return {
      orderNo: String(r["order_id"] ?? "").trim(),
      pendapatan, biaya, cair,
      sumber: mp || "TikTok Shop",
      tanggal,
      detailProduk: r["sku_transactions"] ?? r["sku_details"] ?? undefined,
    };
  }
  // Format laporan Excel (kolom bahasa Indonesia).
  return {
    orderNo: String(r["ID Pesanan/Penyesuaian"] ?? "").trim(),
    pendapatan: angka(r["Total Pendapatan"]),
    biaya: Math.abs(angka(r["Total Biaya"])),
    cair: angka(r["Jumlah penyelesaian pembayaran"]),
    sumber: String(r["Sumber pesanan"] ?? "").trim() || mp || "(tidak disebut)",
    tanggal: String(r["Waktu pemesanan"] ?? r["Waktu pembayaran pesanan"] ?? "").trim(),
    detailProduk: r["Detail produk terjual"],
  };
}

function tgl(v: string | Date | null): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Selisih hari antara dua tanggal "YYYY-MM-DD"; null bila salah satu kosong. */
function selisihHari(orderDate: string, cairDate: string): number | null {
  const a = Date.parse((orderDate || "").slice(0, 10));
  const b = Date.parse((cairDate || "").slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Meringkas biaya marketplace per toko dan per sumber pesanan.
 *
 * Dipisah per SUMBER, bukan hanya per toko: satu laporan TikTok memuat pesanan
 * dari TikTok Shop dan dari Tokopedia sekaligus, dan potongannya berbeda nyata
 * -- terukur 42,0% lawan 35,7% pada toko yang sama. Menggabungkannya
 * menghasilkan satu angka yang tidak benar untuk keduanya.
 */
export function ringkasBiaya(baris: BarisPesanan[]): RingkasanBiaya[] {
  interface Kumpul {
    toko: string; sumber: string; n: number;
    pendapatan: number; biaya: number; rasio: number[];
    dari: string; sampai: string;
  }
  const per = new Map<string, Kumpul>();

  for (const b of baris) {
    const r = (b.raw ?? {}) as Record<string, unknown>;
    const kb = bacaBaris(r, (b.marketplace ?? "").trim());
    const pendapatan = kb.pendapatan;
    // Pesanan berpendapatan nol adalah pembatalan atau retur. Memasukkannya
    // menghasilkan pembagian dengan nol, dan menghitungnya sebagai "biaya 0%"
    // akan menyeret rata-rata ke bawah dengan pesanan yang tidak pernah jadi.
    if (pendapatan <= 0) continue;
    const biaya = kb.biaya;

    const sumber = kb.sumber;
    const toko = (b.namaToko ?? "").trim() || "(tanpa toko)";
    const kunci = `${toko}||${sumber}`;

    const g = per.get(kunci) ?? {
      toko, sumber, n: 0, pendapatan: 0, biaya: 0, rasio: [],
      dari: "", sampai: "",
    };
    g.n += 1;
    g.pendapatan += pendapatan;
    g.biaya += biaya;
    g.rasio.push(biaya / pendapatan);
    const d = tgl(b.periodeDari), s = tgl(b.periodeSampai);
    if (d && (!g.dari || d < g.dari)) g.dari = d;
    if (s && (!g.sampai || s > g.sampai)) g.sampai = s;
    per.set(kunci, g);
  }

  return [...per.values()]
    .map((g) => {
      const urut = [...g.rasio].sort((a, b) => a - b);
      return {
        toko: g.toko,
        sumber: g.sumber,
        pesanan: g.n,
        pendapatan: Math.round(g.pendapatan),
        biaya: Math.round(g.biaya),
        persenTertimbang: g.pendapatan > 0 ? g.biaya / g.pendapatan : 0,
        persenMedian: median(g.rasio),
        persenTerendah: urut[0] ?? 0,
        persenTertinggi: urut[urut.length - 1] ?? 0,
        dari: g.dari,
        sampai: g.sampai,
      };
    })
    .sort((a, b) => b.pesanan - a.pesanan);
}

/**
 * Sebanyak ini pesanan diperlukan sebelum sebuah persentase layak disarankan.
 *
 * Di bawahnya angkanya masih ditampilkan -- menyembunyikan data yang ada
 * membuat orang mengira fiturnya rusak -- tapi ditandai belum cukup, karena
 * satu-dua pesanan dengan ongkir tak lazim bisa menggeser persentasenya
 * belasan angka.
 */
export const MIN_PESANAN = 10;

export function cukupUntukDisarankan(r: RingkasanBiaya): boolean {
  return r.pesanan >= MIN_PESANAN;
}

// ------------------------------------------------- per nomor pesanan

export interface RincianProduk {
  nama: string | null;
  sku: string | null;
  qty: number;
  /** Bagian pencairan order yang dialokasikan ke produk ini (proporsi qty). */
  pencairan: number;
}

export interface BarisBiayaPesanan {
  orderNo: string;
  tanggal: string;
  sumber: string;
  /** Kolom baru: toko, marketplace, tanggal & durasi cair, status scan. */
  namaToko: string | null;
  marketplace: string | null;
  tanggalOrder: string;
  tanggalCair: string;
  /** Selisih hari tanggal cair - tanggal order; null bila salah satunya kosong. */
  durasiCairHari: number | null;
  /** Tanggal mulai delivery (paket dikoleksi kurir / ready-to-ship). */
  tanggalDelivery: string;
  /** Selisih hari tanggal delivery - tanggal order (durasi packing). */
  durasiPackingHari: number | null;
  discan: boolean | null;
  /** Rincian produk dalam order ini + pencairan per produk (expand). */
  rincianProduk: RincianProduk[];
  pendapatan: number;
  biaya: number;
  cair: number;
  /** biaya / pendapatan. Null bila pendapatannya nol (batal/retur). */
  persen: number | null;
  /**
   * Potongannya jauh di atas kebiasaan toko ini.
   *
   * Inilah yang dicari di menu audit: bukan berapa rata-ratanya, melainkan
   * pesanan MANA yang dipotong tidak seperti biasanya -- itu yang bisa
   * ditanyakan ke marketplace-nya satu per satu.
   */
  mencurigakan: boolean;
  /**
   * Produk yang ada di pesanan ini, dari kolom "Detail produk terjual".
   *
   * Nama bernilai null bila ID SKU-nya belum dipetakan ke katalog. Sengaja
   * tidak ditebak dari harga: satu harga dipakai beberapa produk di katalog
   * ini, jadi tebakannya akan terbaca meyakinkan dan tetap keliru.
   */
  produk: ItemProdukPesanan[];
}

export interface SkuBelumDipetakan {
  sku: string;
  /**
   * Marketplace asal SKU ini.
   *
   * Ikut dibawa karena ID SKU hanya unik di dalam satu marketplace, dan
   * pemetaan yang disimpan tanpa menyebut asalnya akan salah dipakai begitu
   * toko kedua diunggah laporannya.
   */
  marketplace: string;
  /** Berapa nomor pesanan memuat SKU ini. */
  pesanan: number;
  qty: number;
  /**
   * Harga jual satuan yang teramati, bila bisa dihitung.
   *
   * Hanya diambil dari pesanan yang isinya satu SKU saja -- pada pesanan
   * campuran, pendapatannya milik beberapa produk sekaligus dan membaginya
   * akan mengarang angka.
   */
  hargaSatuan: number | null;
}

export interface BiayaPerPesanan {
  ringkas: {
    pesanan: number;
    /** Pesanan berpendapatan nol: batal atau retur. Tidak punya persentase. */
    tanpaPendapatan: number;
    pendapatan: number;
    biaya: number;
    cair: number;
    persenTertimbang: number;
    persenMedian: number;
    persenTerendah: number;
    persenTertinggi: number;
    /** Di atas ini sebuah pesanan ditandai mencurigakan. */
    ambangCuriga: number;
    mencurigakan: number;
  };
  baris: BarisBiayaPesanan[];
  /**
   * SKU yang muncul di laporan tapi belum punya nama di katalog.
   *
   * Ditampilkan supaya pemetaan bisa diselesaikan sekali di layar, bukan
   * dibiarkan jadi deretan angka yang tidak berarti apa-apa bagi pembacanya.
   */
  skuBelumDipetakan: SkuBelumDipetakan[];
}

/**
 * Sekian angka persen di atas median sudah dianggap tidak seperti biasanya.
 *
 * Diukur pada laporan sungguhan toko ini, sebaran per pesanan membentang 32%
 * sampai 60% dengan median 42% -- jadi selisih sepuluh angka persen memisahkan
 * ekor atas tanpa menandai separuh daftar. Ambang yang terlalu ketat membuat
 * setiap pesanan tampak mencurigakan, dan daftar yang semuanya merah sama
 * tidak berguna dengan daftar yang semuanya hijau.
 */
export const SELISIH_CURIGA = 0.10;

/**
 * Berapa persen yang dipotong marketplace pada TIAP nomor pesanan.
 *
 * Yang agregat menjawab "berapa biasanya"; yang ini menjawab "pesanan mana
 * yang tidak biasa". Dua pertanyaan berbeda, dan yang kedua itulah pekerjaan
 * sebuah menu audit -- ia harus menghasilkan sesuatu yang bisa ditanyakan,
 * bukan sekadar sesuatu yang bisa dibaca.
 */
export function biayaPerPesanan(
  baris: BarisPesanan[],
  petaSku?: PetaSku,
): BiayaPerPesanan {
  const isi: BarisBiayaPesanan[] = [];
  let tanpaPendapatan = 0;
  // Dikumpulkan sambil jalan supaya laporan "belum dipetakan" berasal dari
  // baris yang benar-benar ditampilkan, bukan dari kueri terpisah yang bisa
  // menyimpang darinya.
  const belum = new Map<
    string,
    { marketplace: string; pesanan: number; qty: number; harga: number[] }
  >();

  for (const b of baris) {
    const r = (b.raw ?? {}) as Record<string, unknown>;
    const kb = bacaBaris(r, (b.marketplace ?? "").trim());
    const orderNo = kb.orderNo;
    const pendapatan = kb.pendapatan;
    const biaya = kb.biaya;
    const cair = kb.cair;
    const sumber = kb.sumber;
    const tanggal = kb.tanggal;

    const produk = cocokkanKeKatalog(
      uraikanDetailProduk(kb.detailProduk),
      petaSku,
    );
    const totalQty = produk.reduce((a, x) => a + x.qty, 0);
    for (const p of produk) {
      if (p.produkId) continue;
      const g = belum.get(p.sku)
        ?? { marketplace: (b.marketplace ?? "").trim() || "(tidak disebut)",
             pesanan: 0, qty: 0, harga: [] };
      g.pesanan += 1;
      g.qty += p.qty;
      // Harga satuan hanya bisa dibaca dari pesanan berisi satu SKU. Pada
      // pesanan campuran, pendapatannya milik beberapa produk sekaligus.
      if (produk.length === 1 && pendapatan > 0 && totalQty > 0) {
        g.harga.push(pendapatan / totalQty);
      }
      belum.set(p.sku, g);
    }

    // Rincian produk + alokasi pencairan (proporsi qty). Utamakan item order
    // tersinkron (sumber API), fallback ke detail produk laporan (unggahan).
    let rincianProduk: RincianProduk[];
    if (b.itemsOrder && b.itemsOrder.length) {
      const items = b.itemsOrder;
      const totalQty = items.reduce((a, it) => a + (Number(it.qty) || 1), 0) || items.length;
      rincianProduk = items.map((it) => {
        const qty = Number(it.qty) || 1;
        const nm = (it.skuId && petaSku?.get(String(it.skuId))?.nama)
          || (it.name ?? "") || (it.skuName ?? "") || null;
        return {
          nama: nm || null,
          sku: it.skuId ? String(it.skuId) : null,
          qty,
          pencairan: totalQty > 0 ? Math.round(cair * qty / totalQty) : 0,
        };
      });
    } else {
      const totalQty = produk.reduce((a, x) => a + x.qty, 0) || produk.length;
      rincianProduk = produk.map((x) => ({
        nama: x.nama,
        sku: x.sku,
        qty: x.qty,
        pencairan: totalQty > 0 ? Math.round(cair * x.qty / totalQty) : 0,
      }));
    }

    const tanggalOrder = (b.tanggalOrder ?? tanggal ?? "") || "";
    const tanggalCair = (b.tanggalCair ?? "") || "";
    const tanggalDelivery = (b.tanggalDelivery ?? "") || "";

    if (pendapatan <= 0) tanpaPendapatan += 1;
    isi.push({
      orderNo, tanggal, sumber,
      namaToko: b.namaToko,
      marketplace: b.marketplace,
      tanggalOrder,
      tanggalCair,
      durasiCairHari: selisihHari(tanggalOrder, tanggalCair),
      tanggalDelivery,
      durasiPackingHari: selisihHari(tanggalOrder, tanggalDelivery),
      discan: b.discan ?? null,
      rincianProduk,
      pendapatan, biaya, cair, produk,
      // Null, bukan nol. Nol terbaca sebagai "tidak dipotong sama sekali",
      // sedangkan yang benar adalah "tidak bisa dihitung" -- pesanan yang
      // dibatalkan tidak punya persentase potongan.
      persen: pendapatan > 0 ? biaya / pendapatan : null,
      mencurigakan: false,
    });
  }

  const persen = isi.map((x) => x.persen).filter((v): v is number => v != null);
  const urut = [...persen].sort((a, b) => a - b);
  const tengah = urut.length
    ? (urut.length % 2 ? urut[(urut.length - 1) / 2]! : (urut[urut.length / 2 - 1]! + urut[urut.length / 2]!) / 2)
    : 0;
  const ambangCuriga = tengah + SELISIH_CURIGA;

  let mencurigakan = 0;
  for (const x of isi) {
    if (x.persen != null && x.persen > ambangCuriga) {
      x.mencurigakan = true;
      mencurigakan += 1;
    }
  }

  const totalPendapatan = isi.reduce((a, x) => a + x.pendapatan, 0);
  const totalBiaya = isi.reduce((a, x) => a + x.biaya, 0);

  // Yang dipotong paling banyak lebih dulu: menu audit dibuka untuk mencari
  // yang tidak beres, bukan untuk membaca seluruh daftar dari atas.
  isi.sort((a, b) => (b.persen ?? -1) - (a.persen ?? -1));

  return {
    ringkas: {
      pesanan: isi.length,
      tanpaPendapatan,
      pendapatan: Math.round(totalPendapatan),
      biaya: Math.round(totalBiaya),
      cair: Math.round(isi.reduce((a, x) => a + x.cair, 0)),
      persenTertimbang: totalPendapatan > 0 ? totalBiaya / totalPendapatan : 0,
      persenMedian: tengah,
      persenTerendah: urut[0] ?? 0,
      persenTertinggi: urut[urut.length - 1] ?? 0,
      ambangCuriga,
      mencurigakan,
    },
    baris: isi,
    skuBelumDipetakan: [...belum.entries()]
      .map(([sku, g]) => ({
        sku,
        marketplace: g.marketplace,
        pesanan: g.pesanan,
        qty: g.qty,
        // Yang paling sering teramati, bukan rata-rata: harga promo sesekali
        // tidak boleh menggeser angka yang dipakai untuk mengenali produk.
        hargaSatuan: g.harga.length ? modus(g.harga) : null,
      }))
      // Yang paling banyak pesanannya lebih dulu: memetakan satu SKU itu
      // menerangkan tiga puluh satu pesanan sekaligus.
      .sort((a, b) => b.pesanan - a.pesanan),
  };
}

/** Nilai yang paling sering muncul; seri dimenangkan yang terkecil. */
function modus(a: number[]): number {
  const n = new Map<number, number>();
  for (const v of a) n.set(v, (n.get(v) ?? 0) + 1);
  let terbaik = a[0]!;
  let banyak = 0;
  for (const [v, c] of [...n.entries()].sort((x, y) => x[0] - y[0])) {
    if (c > banyak) { banyak = c; terbaik = v; }
  }
  return Math.round(terbaik);
}
