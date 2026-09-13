import { describe, it, expect } from "vitest";
import { catalogMatchKey } from "./products.service";

describe("catalogMatchKey", () => {
  it("menyamakan produk yang sama meski spasi/tanda baca beda", () => {
    // Inilah kasus nyatanya: dua toko menulis produk yang sama, satu 'COOL
    // MINT', satu 'COOLMINT'. Harus jatuh ke kunci yang sama.
    const a = catalogMatchKey("Renature Duo Inhaler COOL MINT Menyegarkan dan Melegakan");
    const b = catalogMatchKey("Renature Duo Inhaler COOLMINT Menyegarkan Pernafasan");
    expect(a).toBe(b);
  });

  it("memisahkan produk berbeda dari brand yang sama", () => {
    const coolmint = catalogMatchKey("Renature Duo Inhaler Cool Mint");
    const pepper = catalogMatchKey("Renature Duo Inhaler Peppermint");
    expect(coolmint).not.toBe(pepper);
  });

  it("memaafkan ekor promo yang berbeda", () => {
    const a = catalogMatchKey("Renature Mozzy Gel lotion Anti Nyamuk 50ml BPOM");
    const b = catalogMatchKey("Renature Mozzy Gel lotion Anti Nyamuk 50ml Halal Aman");
    expect(a).toBe(b);
  });

  it("judul kosong menghasilkan kunci kosong (tak dikelompokkan)", () => {
    expect(catalogMatchKey("")).toBe("");
    expect(catalogMatchKey(null)).toBe("");
    expect(catalogMatchKey("   -- //  ")).toBe("");
  });

  it("hanya alfanumerik huruf kecil, panjang terbatas", () => {
    const k = catalogMatchKey("ABC-123 def!@# GHI jkl mno pqr stu vwx yz");
    expect(k).toMatch(/^[a-z0-9]+$/);
    expect(k.length).toBeLessThanOrEqual(24);
    expect(k.startsWith("abc123defghijkl")).toBe(true);
  });
});
