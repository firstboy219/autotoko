import { describe, expect, it } from "vitest";
import { parseShippingLabel } from "./label-parser.js";

/**
 * Fixtures are written the way real Indonesian marketplace labels come out of
 * OCR: inconsistent spacing, the recipient's phone welded onto their name,
 * address lines that look a lot like product lines, and no two marketplaces
 * agreeing on anything.
 */

const TIKTOK = `TikTok Shop
J&T Express
JX1234567890
No. Pesanan: 576234567890123456
Penerima: Budi Santoso 0812-3456-7890
Jl. Merdeka No. 5, Kel. Sukamaju
Kec. Cileungsi, Bogor, Jawa Barat 16820
Produk:
1. Kopi Arabika Gayo 250gr x2
2. Tumbler Stainless 500ml x1
Total: 3 item
`;

const SHOPEE = `Shopee
SPX Express
SPXID043212345678
No Pesanan 2408XYZABC123
Penerima
MAYA SARI
Jl. Anggrek 12, Bandung 40123
Detail Pesanan
Kaos Polos Hitam L 3 pcs
Topi Baseball 1 pcs
`;

const SPARSE = `Anteraja
10000123456789
Kepada: Rina
Jl. Melati 8
`;

describe("parseShippingLabel", () => {
  it("reads a TikTok label end to end", () => {
    const r = parseShippingLabel(TIKTOK);
    expect(r.marketplace).toBe("tiktok");
    expect(r.courier).toBe("J&T");
    expect(r.orderNo).toBe("576234567890123456");
    expect(r.recipient).toBe("Budi Santoso");
    expect(r.items).toEqual([
      { name: "Kopi Arabika Gayo 250gr", qty: 2 },
      { name: "Tumbler Stainless 500ml", qty: 1 },
    ]);
  });

  it("reads a Shopee label whose recipient sits on the next line", () => {
    const r = parseShippingLabel(SHOPEE);
    expect(r.marketplace).toBe("shopee");
    expect(r.courier).toBe("SPX");
    expect(r.orderNo).toBe("2408XYZABC123");
    expect(r.recipient).toBe("MAYA SARI");
    expect(r.items).toEqual([
      { name: "Kaos Polos Hitam L", qty: 3 },
      { name: "Topi Baseball", qty: 1 },
    ]);
  });

  it("does not invent an order number or products when the label has none", () => {
    const r = parseShippingLabel(SPARSE);
    expect(r.courier).toBe("Anteraja");
    expect(r.recipient).toBe("Rina");
    expect(r.orderNo).toBeNull();
    // "Jl. Melati 8" must not become a product just because it has a number.
    expect(r.items).toEqual([]);
  });

  it("never turns an address line into a product", () => {
    const r = parseShippingLabel(`Penerima: Andi
Jl. Kebon Jeruk No. 45 RT 03 RW 09
Kode Pos 11530
`);
    expect(r.items).toEqual([]);
  });

  it("handles a leading quantity (2x Nama)", () => {
    const r = parseShippingLabel("Produk\n2x Sabun Cair Refill 800ml\n");
    expect(r.items).toEqual([{ name: "Sabun Cair Refill 800ml", qty: 2 }]);
  });

  it("collapses a line OCR read twice", () => {
    const r = parseShippingLabel("Produk\nKopi Gayo x2\nKopi Gayo x2\n");
    expect(r.items).toEqual([{ name: "Kopi Gayo", qty: 2 }]);
  });

  it("stops the product block at Total", () => {
    const r = parseShippingLabel(`Produk
Teh Melati 100gr x1
Total: 1 item
Ongkir 12000
Estimasi tiba besok
`);
    expect(r.items).toEqual([{ name: "Teh Melati 100gr", qty: 1 }]);
  });

  it("rejects an order number too short to be real", () => {
    expect(parseShippingLabel("No. Pesanan: 123\n").orderNo).toBeNull();
  });

  it("is safe on empty and junk input", () => {
    expect(parseShippingLabel("")).toEqual({
      orderNo: null, recipient: null, marketplace: null, courier: null, items: [],
    });
    expect(parseShippingLabel("   ").orderNo).toBeNull();
    expect(parseShippingLabel("!!! ??? ...").items).toEqual([]);
  });
});
