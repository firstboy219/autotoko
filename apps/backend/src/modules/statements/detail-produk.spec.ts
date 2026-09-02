import { describe, it, expect } from "vitest";
import { uraikanDetailProduk, cocokkanKeKatalog } from "./detail-produk";

describe("uraikanDetailProduk", () => {
  it("membaca bentuk yang sebenarnya ada di laporan", () => {
    // Baris nyata dari laporan penyelesaian toko ini.
    expect(uraikanDetailProduk("1731350028413076965 * 1;")).toEqual([
      { sku: "1731350028413076965", qty: 1 },
    ]);
  });

  it('memperlakukan "/" sebagai tanpa produk, bukan sebagai SKU', () => {
    // Baris penyesuaian dan retur ditulis begini. Kalau "/" lolos sebagai
    // produk, layar audit akan menampilkan produk hantu di 24 pesanan.
    expect(uraikanDetailProduk("/")).toEqual([]);
    expect(uraikanDetailProduk("")).toEqual([]);
    expect(uraikanDetailProduk(null)).toEqual([]);
    expect(uraikanDetailProduk(undefined)).toEqual([]);
  });

  it("membaca pesanan berisi lebih dari satu produk", () => {
    // Dipisah baris baru DAN titik koma sekaligus -- keduanya muncul bersama
    // di laporan yang sama, jadi keduanya harus jadi pemisah.
    expect(uraikanDetailProduk("1731335317582218725 * 2;\n1731335307116840421 * 1;"))
      .toEqual([
        { sku: "1731335317582218725", qty: 2 },
        { sku: "1731335307116840421", qty: 1 },
      ]);
  });

  it("menjumlahkan SKU yang sama bila ditulis dua kali", () => {
    // Satu produk dua baris adalah satu produk berjumlah dua, bukan dua
    // baris terpisah yang menyesatkan saat dibaca.
    expect(uraikanDetailProduk("1731 * 1;1731 * 2;")).toEqual([{ sku: "1731", qty: 3 }]);
  });

  it("menganggap jumlah yang rusak sebagai satu, bukan membuang produknya", () => {
    // Produknya jelas ada di pesanan itu; yang rusak hanya jumlahnya.
    // Membuang barisnya akan menghilangkan produk yang benar-benar terjual.
    expect(uraikanDetailProduk("1731350028413076965 * ;")).toEqual([
      { sku: "1731350028413076965", qty: 1 },
    ]);
    expect(uraikanDetailProduk("1731350028413076965 * 0;")).toEqual([
      { sku: "1731350028413076965", qty: 1 },
    ]);
  });

  it("menerima SKU tanpa tanda bintang", () => {
    expect(uraikanDetailProduk("KOPI-ARABIKA-200")).toEqual([
      { sku: "KOPI-ARABIKA-200", qty: 1 },
    ]);
  });

  it("membuang sisa pemisahan yang terlalu pendek", () => {
    // Tanpa ini, titik koma beruntun menghasilkan produk bernama satu huruf.
    expect(uraikanDetailProduk("1731350028413076965 * 1;;a;")).toEqual([
      { sku: "1731350028413076965", qty: 1 },
    ]);
  });

  it("tahan terhadap spasi yang tidak rapi", () => {
    expect(uraikanDetailProduk("  1731350028413076965*3 ; ")).toEqual([
      { sku: "1731350028413076965", qty: 3 },
    ]);
  });
});

describe("cocokkanKeKatalog", () => {
  const peta = new Map([["1731", { id: "abc", nama: "Sleep Spray" }]]);

  it("menempelkan nama untuk SKU yang sudah dipetakan", () => {
    expect(cocokkanKeKatalog([{ sku: "1731", qty: 2 }], peta)).toEqual([
      { sku: "1731", qty: 2, nama: "Sleep Spray", produkId: "abc" },
    ]);
  });

  it("membiarkan nama null untuk yang belum dipetakan, bukan menebak", () => {
    // Nama yang ditebak akan terbaca sama meyakinkannya dengan yang benar.
    // Null memaksa layar mengatakan "belum dipetakan", yang jujur.
    expect(cocokkanKeKatalog([{ sku: "9999", qty: 1 }], peta)).toEqual([
      { sku: "9999", qty: 1, nama: null, produkId: null },
    ]);
  });

  it("tetap bekerja tanpa peta sama sekali", () => {
    expect(cocokkanKeKatalog([{ sku: "9999", qty: 1 }])).toEqual([
      { sku: "9999", qty: 1, nama: null, produkId: null },
    ]);
  });
});
