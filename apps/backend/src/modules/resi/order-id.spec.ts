import { describe, expect, it } from "vitest";
import {
  bacaOrderId,
  bacaSemuaOrderId,
  bestOrderId,
  findOrderId,
  isOrderId,
  normaliseOrderId,
  normaliseOrderIdTyped,
} from "./order-id.js";

/**
 * Dua janji yang harus dijaga bersamaan, dan dulu hanya satu yang dijaga.
 *
 * 1. Kolom order id tidak pernah berisi tebakan yang disimpan diam-diam.
 * 2. Nomor pesanan yang jelas-jelas tercetak di label tidak boleh gagal
 *    terbaca. Menjaga janji pertama dengan cara melanggar janji kedua adalah
 *    persis kegagalan yang terlihat di hasil tes: "No.Pesanan: 260827EXWKKVDE"
 *    terbaca sempurna, ditolak, dan seluruh paket Shopee berhenti di sana.
 *
 * Nilainya diambil dari data sungguhan -- order id asli dari laporan
 * penyelesaian TikTok, sampah asli yang pernah tersimpan di kolom ini, dan
 * label Shopee dari tangkapan layar hasil tes.
 */
describe("order id", () => {
  const ASLI = "585623070310172189"; // dari laporan, jenis "Pesanan"
  const SHOPEE = "260827EXWKKVDE";
  const LABEL_SHOPEE =
    "Penerima: Ziza\nBerat: 10 gr    COD Cek Dulu: Tidak\n" +
    "Batas Kirim: 28-08-2026\nNo.Pesanan: " + SHOPEE + "\n";

  // --- jalur ketat: dipakai membaca laporan marketplace --------------------

  describe("normaliseOrderId tetap ketat", () => {
    /**
     * Sengaja TIDAK ikut dilonggarkan. Fungsi ini membaca kolom "ID Pesanan"
     * di laporan penyelesaian marketplace, di mana 18 digit murni memang
     * satu-satunya bentuk yang ada. Melonggarkan di sini akan membuat
     * pencocokan pencairan mulai menerima nilai yang bukan pesanan.
     */
    it("menerima 18 digit apa adanya", () => {
      expect(normaliseOrderId(ASLI)).toBe(ASLI);
      expect(isOrderId(ASLI)).toBe(true);
    });

    it("memperbaiki huruf yang tertukar angka, kalau hasilnya jadi sah", () => {
      expect(normaliseOrderId("S85623070310172189")).toBe(ASLI);
      expect(normaliseOrderId("5856230703101721B9")).toBe(ASLI);
    });

    it("menolak yang masih bersisa huruf setelah diperbaiki", () => {
      expect(normaliseOrderId("SH8476199355610969")).toBeNull();
      expect(normaliseOrderId("SHS4BSTISSIATTO04E")).toBeNull();
    });

    it("menolak kode sortir kurir dan panjang yang salah", () => {
      expect(normaliseOrderId("2605149T3NJJJN")).toBeNull();
      expect(normaliseOrderId("585691")).toBeNull();
      expect(normaliseOrderId("3690853782936651237")).toBeNull();
    });

    it("mengabaikan spasi dan tanda pemisah", () => {
      expect(normaliseOrderId("5856 2307 0310 172189")).toBe(ASLI);
      expect(normaliseOrderId("585623-070310-172189")).toBe(ASLI);
    });
  });

  // --- yang diperbaiki -----------------------------------------------------

  describe("label Shopee dari hasil tes", () => {
    it("terbaca, dan tidak lagi berhenti di langkah wajib", () => {
      expect(findOrderId(LABEL_SHOPEE)).toBe(SHOPEE);
    });

    it("alasannya menyebut jangkarnya, supaya penolakan tidak pernah bisu", () => {
      const b = bacaOrderId(LABEL_SHOPEE)!;
      expect(b.keyakinan).toBe("tinggi");
      expect(b.keluarga).toBe("Shopee");
      expect(b.berjangkar).toBe(true);
      expect(b.alasan.join(" ")).toContain("No. Pesanan");
    });

    it("berat dan batas kirim di label yang sama tidak ikut terbawa", () => {
      const nilai = bacaSemuaOrderId(LABEL_SHOPEE).map((b) => b.nilai);
      expect(nilai).toEqual([SHOPEE]);
    });
  });

  // --- yang tidak boleh ikut longgar ---------------------------------------

  it("menolak nomor pengiriman kurir walau berjangkar", () => {
    expect(findOrderId("Order ID: SPXID064183635268")).toBeNull();
    expect(findOrderId("No. Pesanan: JX1234567890123")).toBeNull();
  });

  /**
   * Perbaikan huruf diperiksa SESUDAH pemeriksaan "jelas bukan", bukan
   * sebelum: "SPXID0641..." yang diperbaiki jadi "5PX10064..." tidak lagi
   * berawalan kode kurir dan akan lolos, padahal yang tercetak di kertas itu
   * tetap nomor pengiriman.
   */
  it("perbaikan huruf tidak bisa menyelundupkan nomor kurir", () => {
    expect(bacaSemuaOrderId("Order ID: SPXID064183635268")).toEqual([]);
  });

  it("nilai di sebelah kata resi tidak pernah jadi order id", () => {
    expect(findOrderId(`No. Resi: ${ASLI}`)).toBeNull();
    expect(findOrderId(`AWB: ${SHOPEE}`)).toBeNull();
    expect(bacaSemuaOrderId(`Nomor Resi ${ASLI}`)).toEqual([]);
  });

  /**
   * Tanpa batas non-digit, /\d{18}/ mencocok DELAPAN BELAS ANGKA PERTAMA dari
   * package id 19 digit dan menghasilkan order id yang terpotong satu angka.
   * Bentuknya sempurna, nilainya salah, dan tidak akan pernah berpasangan
   * dengan laporan mana pun.
   */
  it("tidak memotong angka yang lebih panjang", () => {
    expect(findOrderId("Package ID 1205938906612515436")).toBeNull();
    expect(findOrderId("1206362770642142504")).toBeNull();
  });

  it("menolak memilih kalau ada dua yang sama kuat", () => {
    expect(findOrderId(`${ASLI}\n585688912408380856`)).toBeNull();
  });

  it("jangkar menang atas angka telanjang", () => {
    expect(findOrderId(`585688912408380856\nOrder ID: ${ASLI}`)).toBe(ASLI);
  });

  it("angka telanjang 18 digit tetap diterima", () => {
    expect(findOrderId(`tokopedia Shop\n${ASLI}\nJNE`)).toBe(ASLI);
  });

  // --- tingkat sedang: ditawarkan, bukan ditolak diam-diam -----------------

  /**
   * Inti dari perubahannya.
   *
   * Kode sortir kurir tidak bisa dibedakan bentuknya dari nomor pesanan
   * Shopee. Dulu itu alasan menolak SEMUA bentuk Shopee dari OCR -- membuang
   * yang benar bersama yang salah, lalu diam soal apa yang sebenarnya terbaca.
   * Sekarang ia tetap tidak dipakai otomatis, tapi TIDAK hilang: nilainya
   * ditawarkan, dan yang memutuskan adalah orang yang memegang labelnya.
   */
  it("bentuk Shopee tanpa jangkar ditawarkan, bukan dibuang", () => {
    const teks = `BW-33\n${SHOPEE}\nSPX`;
    expect(findOrderId(teks)).toBeNull();
    const b = bacaOrderId(teks)!;
    expect(b.nilai).toBe(SHOPEE);
    expect(b.keyakinan).toBe("sedang");
    expect(b.berjangkar).toBe(false);
  });

  it("kode sortir kurir juga hanya sampai tingkat sedang", () => {
    expect(bacaOrderId("2605149T3NJJJN")!.keyakinan).toBe("sedang");
  });

  it("tanggal yang mustahil menjatuhkan bentuk Shopee", () => {
    // Bulan 99 bukan tanggal, jadi ini bukan nomor pesanan Shopee.
    expect(bacaSemuaOrderId("999999ABCDEFGH").map((b) => b.nilai)).toEqual([]);
  });

  // --- ketikan atau pembenaran orang ---------------------------------------

  it("ketikan orang jauh lebih longgar", () => {
    // Yang mengetik sedang memegang labelnya. Menolak di sini berarti
    // menghentikan pekerjaan atas nama ketelitian.
    expect(normaliseOrderIdTyped(SHOPEE)).toBe(SHOPEE);
    expect(normaliseOrderIdTyped(ASLI)).toBe(ASLI);
    expect(normaliseOrderIdTyped("inv/20260827/mpl/123456")).toBe("INV20260827MPL123456");
  });

  it("ketikan tetap menolak yang jelas bukan", () => {
    expect(normaliseOrderIdTyped("SPXID064183635268")).toBeNull();
    expect(normaliseOrderIdTyped("081234567890")).toBeNull();
    expect(normaliseOrderIdTyped("12345")).toBeNull();
  });

  it("bestOrderId mendahulukan yang tersimpan", () => {
    expect(bestOrderId(ASLI, "teks apa pun")).toBe(ASLI);
    expect(bestOrderId(null, `Order ID: ${ASLI}`)).toBe(ASLI);
    expect(bestOrderId("081234567890", `Order ID: ${ASLI}`)).toBe(ASLI);
    expect(bestOrderId(null, "tidak ada apa-apa")).toBeNull();
  });

  it("kosong tetap kosong", () => {
    expect(normaliseOrderId(null)).toBeNull();
    expect(normaliseOrderId("")).toBeNull();
    expect(findOrderId(null)).toBeNull();
    expect(bacaOrderId("")).toBeNull();
    expect(bacaSemuaOrderId(null)).toEqual([]);
  });
});
