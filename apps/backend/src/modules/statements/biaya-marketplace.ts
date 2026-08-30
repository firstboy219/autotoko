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
