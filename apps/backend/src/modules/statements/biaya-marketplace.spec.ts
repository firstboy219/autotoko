import { describe, expect, it } from "vitest";
import {
  MIN_PESANAN,
  SELISIH_CURIGA,
  angka,
  biayaPerPesanan,
  cukupUntukDisarankan,
  ringkasBiaya,
  type BarisPesanan,
} from "./biaya-marketplace.js";

/**
 * Nilai-nilai di sini disalin dari laporan penyelesaian TikTok yang sungguhan,
 * termasuk hasil yang sudah terukur: 42,0% untuk TikTok Shop dan 35,7% untuk
 * Tokopedia pada toko yang sama.
 */
describe("biaya marketplace dari laporan", () => {
  const baris = (
    pendapatan: string, biaya: string, sumber: string, toko = "Bulanjacom",
  ): BarisPesanan => ({
    raw: {
      "Total Pendapatan": pendapatan,
      "Total Biaya": biaya,
      "Sumber pesanan": sumber,
      "Jenis transaksi": "Pesanan",
    },
    namaToko: toko,
    marketplace: "tiktok",
    periodeDari: "2026-07-01",
    periodeSampai: "2026-08-30",
  });

  it("membaca angka bertanda minus dan bertitik ribuan", () => {
    expect(angka("-14659")).toBe(-14659);
    expect(angka("-14.659")).toBe(-14659);
    expect(angka("39300")).toBe(39300);
    expect(angka("")).toBe(0);
    expect(angka(null)).toBe(0);
    expect(angka(24641)).toBe(24641);
  });

  /** Baris nyata dari laporan: pendapatan 39.300, biaya -14.659. */
  it("menghitung persentase dari satu pesanan sungguhan", () => {
    const [r] = ringkasBiaya([baris("39300", "-14659", "Tokopedia")]);
    expect(r!.pesanan).toBe(1);
    expect(r!.pendapatan).toBe(39300);
    expect(r!.biaya).toBe(14659);
    expect(r!.persenTertimbang).toBeCloseTo(0.373, 3);
  });

  /**
   * Dipisah per sumber, bukan hanya per toko: satu laporan TikTok memuat
   * pesanan TikTok Shop dan Tokopedia sekaligus, dan potongannya berbeda nyata.
   * Menggabungkannya menghasilkan satu angka yang tidak benar untuk keduanya.
   */
  it("memisahkan TikTok Shop dari Tokopedia walau satu laporan", () => {
    const hasil = ringkasBiaya([
      baris("49300", "-23442", "TikTok Shop"),
      baris("49300", "-20000", "TikTok Shop"),
      baris("39300", "-14659", "Tokopedia"),
    ]);
    expect(hasil).toHaveLength(2);
    const tt = hasil.find((x) => x.sumber === "TikTok Shop")!;
    const tp = hasil.find((x) => x.sumber === "Tokopedia")!;
    expect(tt.pesanan).toBe(2);
    expect(tp.pesanan).toBe(1);
    expect(tt.persenTertimbang).toBeGreaterThan(tp.persenTertimbang);
  });

  /**
   * Pembatalan dan retur berpendapatan nol. Menghitungnya sebagai "biaya 0%"
   * menyeret rata-rata ke bawah dengan pesanan yang tidak pernah jadi -- dan
   * di laporan sungguhan jumlahnya 43 dari 143.
   */
  it("pesanan berpendapatan nol tidak dihitung", () => {
    const hasil = ringkasBiaya([
      baris("39300", "-14659", "Tokopedia"),
      baris("0", "0", "Tokopedia"),
      baris("0", "0", "Tokopedia"),
    ]);
    expect(hasil[0]!.pesanan).toBe(1);
    expect(hasil[0]!.persenTertimbang).toBeCloseTo(0.373, 3);
  });

  /**
   * Median dan tertimbang menjawab pertanyaan yang berbeda: satu pesanan besar
   * dengan biaya tak lazim menggeser yang tertimbang, tidak yang median.
   */
  it("satu pesanan besar tak lazim tidak menggeser median", () => {
    const kecil = Array.from({ length: 9 }, () => baris("50000", "-20000", "TikTok Shop"));
    const [r] = ringkasBiaya([...kecil, baris("5000000", "-3000000", "TikTok Shop")]);
    expect(r!.persenMedian).toBeCloseTo(0.4, 2);
    expect(r!.persenTertimbang).toBeGreaterThan(0.5);
  });

  it("membawa rentang terendah dan tertinggi apa adanya", () => {
    const [r] = ringkasBiaya([
      baris("100000", "-32000", "TikTok Shop"),
      baris("100000", "-60000", "TikTok Shop"),
      baris("100000", "-42000", "TikTok Shop"),
    ]);
    expect(r!.persenTerendah).toBeCloseTo(0.32, 2);
    expect(r!.persenTertinggi).toBeCloseTo(0.60, 2);
    expect(r!.persenMedian).toBeCloseTo(0.42, 2);
  });

  it("periode diambil dari yang paling awal sampai paling akhir", () => {
    const a = { ...baris("50000", "-20000", "TikTok Shop"), periodeDari: "2026-07-01", periodeSampai: "2026-07-31" };
    const b = { ...baris("50000", "-20000", "TikTok Shop"), periodeDari: "2026-08-01", periodeSampai: "2026-08-30" };
    const [r] = ringkasBiaya([a, b]);
    expect(r!.dari).toBe("2026-07-01");
    expect(r!.sampai).toBe("2026-08-30");
  });

  it("sumber yang tidak disebut jatuh ke marketplace-nya", () => {
    const [r] = ringkasBiaya([{
      raw: { "Total Pendapatan": "50000", "Total Biaya": "-20000" },
      namaToko: "Bulanjacom", marketplace: "shopee",
      periodeDari: "2026-08-01", periodeSampai: "2026-08-30",
    }]);
    expect(r!.sumber).toBe("shopee");
  });

  /**
   * Di bawah ambang angkanya tetap ditampilkan -- menyembunyikan data yang ada
   * membuat orang mengira fiturnya rusak -- tapi tidak disarankan.
   */
  it("terlalu sedikit pesanan belum layak disarankan", () => {
    const sedikit = ringkasBiaya(
      Array.from({ length: MIN_PESANAN - 1 }, () => baris("50000", "-20000", "TikTok Shop")),
    );
    expect(cukupUntukDisarankan(sedikit[0]!)).toBe(false);
    const cukup = ringkasBiaya(
      Array.from({ length: MIN_PESANAN }, () => baris("50000", "-20000", "TikTok Shop")),
    );
    expect(cukupUntukDisarankan(cukup[0]!)).toBe(true);
  });

  it("tanpa baris sama sekali menghasilkan daftar kosong", () => {
    expect(ringkasBiaya([])).toEqual([]);
    expect(ringkasBiaya([baris("0", "0", "TikTok Shop")])).toEqual([]);
  });

  it("diurutkan dari yang paling banyak pesanannya", () => {
    const hasil = ringkasBiaya([
      baris("50000", "-20000", "Tokopedia"),
      ...Array.from({ length: 3 }, () => baris("50000", "-20000", "TikTok Shop")),
    ]);
    expect(hasil[0]!.sumber).toBe("TikTok Shop");
  });
});

/**
 * Menu audit menanyakan hal yang berbeda dari halaman HPP.
 *
 * HPP bertanya "berapa biasanya dipotong"; audit bertanya "pesanan MANA yang
 * dipotong tidak seperti biasanya". Yang kedua harus menghasilkan sesuatu yang
 * bisa ditanyakan ke marketplace-nya satu per satu.
 */
describe("biaya per nomor pesanan", () => {
  const p = (
    orderNo: string, pendapatan: string, biaya: string, cair: string,
    sumber = "TikTok Shop",
  ): BarisPesanan => ({
    raw: {
      "ID Pesanan/Penyesuaian": orderNo,
      "Total Pendapatan": pendapatan,
      "Total Biaya": biaya,
      "Jumlah penyelesaian pembayaran": cair,
      "Sumber pesanan": sumber,
      "Waktu pemesanan": "2026/08/19",
    },
    namaToko: "Bulanjacom", marketplace: "tiktok",
    periodeDari: "2026-08-01", periodeSampai: "2026-08-31",
  });

  /** Baris nyata dari laporan: 49.300 pendapatan, 23.442 biaya, 25.858 cair. */
  it("menghitung persentase satu pesanan sungguhan", () => {
    const h = biayaPerPesanan([p("585623070310172189", "49300", "-23442", "25858")]);
    const b = h.baris[0]!;
    expect(b.orderNo).toBe("585623070310172189");
    expect(b.pendapatan).toBe(49300);
    expect(b.biaya).toBe(23442);
    expect(b.cair).toBe(25858);
    expect(b.persen).toBeCloseTo(0.4755, 3);
    expect(b.sumber).toBe("TikTok Shop");
  });

  /**
   * Pesanan batal tidak punya persentase. Null, bukan nol -- nol terbaca
   * sebagai "tidak dipotong sama sekali", yang justru kesimpulan salah.
   */
  it("pesanan berpendapatan nol tidak dipaksa punya persentase", () => {
    const h = biayaPerPesanan([p("X1", "0", "0", "0")]);
    expect(h.baris[0]!.persen).toBeNull();
    expect(h.ringkas.tanpaPendapatan).toBe(1);
    expect(h.ringkas.persenMedian).toBe(0);
  });

  it("menandai yang dipotong jauh di atas kebiasaan", () => {
    const biasa = Array.from({ length: 9 }, (_, i) => p(`N${i}`, "100000", "-40000", "60000"));
    const h = biayaPerPesanan([...biasa, p("ANEH", "100000", "-70000", "30000")]);
    expect(h.ringkas.persenMedian).toBeCloseTo(0.4, 2);
    expect(h.ringkas.ambangCuriga).toBeCloseTo(0.4 + SELISIH_CURIGA, 3);
    expect(h.ringkas.mencurigakan).toBe(1);
    const aneh = h.baris.find((x) => x.orderNo === "ANEH")!;
    expect(aneh.mencurigakan).toBe(true);
    // Yang biasa tidak ikut ditandai: daftar yang semuanya merah sama tidak
    // bergunanya dengan daftar yang semuanya hijau.
    expect(h.baris.filter((x) => x.mencurigakan)).toHaveLength(1);
  });

  it("yang dipotong paling banyak muncul lebih dulu", () => {
    const h = biayaPerPesanan([
      p("KECIL", "100000", "-30000", "70000"),
      p("BESAR", "100000", "-60000", "40000"),
      p("BATAL", "0", "0", "0"),
    ]);
    expect(h.baris[0]!.orderNo).toBe("BESAR");
    expect(h.baris[1]!.orderNo).toBe("KECIL");
    // Yang tanpa persentase di ekor, bukan di kepala.
    expect(h.baris[2]!.orderNo).toBe("BATAL");
  });

  it("ringkasan konsisten dengan barisnya", () => {
    const h = biayaPerPesanan([
      p("A", "50000", "-20000", "30000"),
      p("B", "50000", "-30000", "20000"),
    ]);
    expect(h.ringkas.pesanan).toBe(2);
    expect(h.ringkas.pendapatan).toBe(100000);
    expect(h.ringkas.biaya).toBe(50000);
    expect(h.ringkas.cair).toBe(50000);
    expect(h.ringkas.persenTertimbang).toBeCloseTo(0.5, 3);
    expect(h.ringkas.persenTerendah).toBeCloseTo(0.4, 3);
    expect(h.ringkas.persenTertinggi).toBeCloseTo(0.6, 3);
  });

  it("tanpa baris sama sekali tetap bentuk yang bisa dibaca", () => {
    const h = biayaPerPesanan([]);
    expect(h.baris).toEqual([]);
    expect(h.ringkas.pesanan).toBe(0);
    expect(h.ringkas.persenTertimbang).toBe(0);
    expect(h.ringkas.mencurigakan).toBe(0);
  });
});
