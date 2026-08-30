import { describe, expect, it } from "vitest";
import { bestOrderId, findOrderId, isOrderId, normaliseOrderId } from "./order-id.js";

/**
 * Yang dijaga di sini adalah sebuah janji: kolom order id hanya berisi nilai
 * yang mungkin, atau kosong. Tidak ada tebakan.
 *
 * Nilainya diambil dari data sungguhan -- order id asli dari laporan
 * penyelesaian TikTok, dan sampah asli yang selama ini tersimpan di kolom itu.
 */
describe("order id", () => {
  const ASLI = "585623070310172189"; // dari laporan, jenis "Pesanan"

  it("menerima 18 digit apa adanya", () => {
    expect(normaliseOrderId(ASLI)).toBe(ASLI);
    expect(isOrderId(ASLI)).toBe(true);
  });

  it("memperbaiki huruf yang tertukar angka, kalau hasilnya jadi sah", () => {
    // Kasus nyata dari database: S menggantikan 5 di awal.
    expect(normaliseOrderId("S85623070310172189")).toBe(ASLI);
    expect(normaliseOrderId("5856230703101721B9")).toBe(ASLI);
  });

  it("menolak yang masih bersisa huruf setelah diperbaiki", () => {
    // Ini nomor pengiriman Shopee, bukan order id -- H tidak ada di peta.
    expect(normaliseOrderId("SH8476199355610969")).toBeNull();
    expect(normaliseOrderId("SHS4BSTISSIATTO04E")).toBeNull();
  });

  it("menolak kode sortir kurir", () => {
    expect(normaliseOrderId("2605149T3NJJJN")).toBeNull();
    expect(normaliseOrderId("260B100JHWOY")).toBeNull();
    expect(normaliseOrderId("28082341EHVNMU")).toBeNull();
  });

  it("menolak yang panjangnya salah", () => {
    expect(normaliseOrderId("585691")).toBeNull();
    expect(normaliseOrderId("12775002522784")).toBeNull();
    // 19 digit BUKAN order id: di laporan, entri 19 digit seluruhnya
    // referensi pencairan di muka atau penyesuaian komisi.
    expect(normaliseOrderId("3690853782936651237")).toBeNull();
  });

  it("mengabaikan spasi dan tanda pemisah", () => {
    expect(normaliseOrderId("5856 2307 0310 172189")).toBe(ASLI);
    expect(normaliseOrderId("585623-070310-172189")).toBe(ASLI);
  });

  it("membaca yang berjangkar dari teks label", () => {
    expect(findOrderId(`Penerima: Budi\nOrder ID : ${ASLI}\nJNE REG`)).toBe(ASLI);
    expect(findOrderId(`No. Pesanan ${ASLI}`)).toBe(ASLI);
  });

  it("membaca angka telanjang 18 digit", () => {
    expect(findOrderId(`tokopedia Shop\n${ASLI}\nJNE`)).toBe(ASLI);
  });

  /**
   * Pemeriksaan yang paling penting di berkas ini.
   *
   * Tanpa batas non-digit, /\d{18}/ mencocok DELAPAN BELAS ANGKA PERTAMA dari
   * package id 19 digit dan menghasilkan order id yang terpotong satu angka.
   * Bentuknya sempurna, nilainya salah, dan tidak akan pernah berpasangan
   * dengan laporan mana pun.
   */
  it("tidak memotong angka yang lebih panjang", () => {
    expect(findOrderId("Package ID 1205938906612515436")).toBeNull();
    expect(findOrderId("1206362770642142504")).toBeNull();
  });

  it("menolak memilih kalau ada beberapa angka 18 digit berbeda", () => {
    expect(findOrderId(`${ASLI}\n585688912408380856`)).toBeNull();
  });

  it("jangkar menang atas angka telanjang", () => {
    const lain = "585688912408380856";
    expect(findOrderId(`${lain}\nOrder ID: ${ASLI}`)).toBe(ASLI);
  });

  it("bestOrderId mendahulukan yang tersimpan, tapi tetap memeriksanya", () => {
    expect(bestOrderId(ASLI, "teks apa pun")).toBe(ASLI);
    // Tersimpan tapi sampah -> jatuh ke teks.
    expect(bestOrderId("2605149T3NJJJN", `Order ID: ${ASLI}`)).toBe(ASLI);
    // Dua-duanya sampah -> kosong, bukan tebakan.
    expect(bestOrderId("2605149T3NJJJN", "tidak ada apa-apa")).toBeNull();
  });

  it("kosong tetap kosong", () => {
    expect(normaliseOrderId(null)).toBeNull();
    expect(normaliseOrderId("")).toBeNull();
    expect(findOrderId(null)).toBeNull();
  });
});
