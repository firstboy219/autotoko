import { describe, expect, it } from "vitest";
import {
  MIN_PESANAN,
  angka,
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
