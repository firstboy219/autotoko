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
    const pendapatan = angka(r["Total Pendapatan"]);
    // Pesanan berpendapatan nol adalah pembatalan atau retur. Memasukkannya
    // menghasilkan pembagian dengan nol, dan menghitungnya sebagai "biaya 0%"
    // akan menyeret rata-rata ke bawah dengan pesanan yang tidak pernah jadi.
    if (pendapatan <= 0) continue;
    const biaya = Math.abs(angka(r["Total Biaya"]));

    const sumber = String(r["Sumber pesanan"] ?? "").trim()
      || (b.marketplace ?? "").trim()
      || "(tidak disebut)";
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

export interface BarisBiayaPesanan {
  orderNo: string;
  tanggal: string;
  sumber: string;
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
    const orderNo = String(r["ID Pesanan/Penyesuaian"] ?? "").trim();
    const pendapatan = angka(r["Total Pendapatan"]);
    const biaya = Math.abs(angka(r["Total Biaya"]));
    const cair = angka(r["Jumlah penyelesaian pembayaran"]);
    const sumber = String(r["Sumber pesanan"] ?? "").trim()
      || (b.marketplace ?? "").trim()
      || "(tidak disebut)";
    const tanggal = String(r["Waktu pemesanan"] ?? r["Waktu pembayaran pesanan"] ?? "").trim();

    const produk = cocokkanKeKatalog(
      uraikanDetailProduk(r["Detail produk terjual"]),
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

    if (pendapatan <= 0) tanpaPendapatan += 1;
    isi.push({
      orderNo, tanggal, sumber, pendapatan, biaya, cair, produk,
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
