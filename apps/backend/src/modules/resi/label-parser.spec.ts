import { describe, expect, it } from "vitest";
import { EMPTY_LABEL, parseShippingLabel } from "./label-parser.js";

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
    // Order id Shopee berbentuk alfanumerik, dan pengesah order id sekarang
    // hanya menerima 18 digit murni -- bentuk yang terbukti dari laporan
    // penyelesaian TikTok/Tokopedia. Shopee belum punya kebenaran acuan, dan
    // melonggarkan aturan untuknya berarti menerima kembali nomor pengiriman
    // dan kode sortir yang selama ini mengotori kolom ini (79% dari isinya).
    // Kosong lebih jujur daripada tebakan: yang salah akan gagal berpasangan
    // dengan laporan secara diam-diam dan terbaca sebagai pesanan hilang.
    expect(r.orderNo).toBeNull();
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
    // Compared against EMPTY_LABEL rather than a literal: the field list grows
    // as more of the label gets read, and a literal here would have to be
    // edited every time without ever catching a real defect.
    expect(parseShippingLabel("")).toEqual(EMPTY_LABEL);
    expect(parseShippingLabel("   ").orderNo).toBeNull();
    expect(parseShippingLabel("!!! ??? ...").items).toEqual([]);
  });

  // The block below is a J&T/Tokopedia label transcribed from a real parcel
  // photographed by the warehouse scanner, with the personal details changed.
  // It is what the printed layout looks like when OCR reads it cleanly, which
  // is the case the parser exists to handle.
  const REAL_LABEL = `J&T EXPRESS      ECO
Pengirim : Ashal Store  (+62)85975141268
DKI JAKARTA,JAKARTA
Penerima : Budi S  (+62)81*******95
LAMPUNG,LAMPUNG SELATAN,PENENGAHAN
Toko aditya ,desa rawi rt03rw01
Wght    0.159 KG        Ship  04-08-2026
Jumlah 1pcs Barang  Isi: 10ML
COD
TOKO ADITYA
260-BKH08-05
JY1387483282
Order Id : 585358045683221740     Estimated Date:
In transit by: 04/08/2026 23:59
Product Name          SKU        Seller SKU     Qty
Renature Cool Mint Mouthspray x1
Qty Total: 1
tokopedia | Shop        Order ID: 585358045683221740
Package ID: 1205938906612515436
NickName: dapurneva
`;

  it("reads the sending shop and its city off a real label", () => {
    const r = parseShippingLabel(REAL_LABEL);
    // The phone number OCR runs onto the same line must not become part of the
    // shop's name.
    expect(r.senderName).toBe("Ashal Store");
    expect(r.senderArea).toBe("DKI JAKARTA,JAKARTA");
  });

  it("reads the recipient with their area and street", () => {
    const r = parseShippingLabel(REAL_LABEL);
    expect(r.recipient).toBe("Budi S");
    expect(r.recipientArea).toBe("LAMPUNG,LAMPUNG SELATAN,PENENGAHAN");
    expect(r.recipientAddress).toContain("desa rawi rt03rw01");
  });

  it("does not hand the sender the recipient's province", () => {
    // Without the bound at the recipient's line, a sender printed with no area
    // under it adopts the next area on the label, which is the destination.
    const r = parseShippingLabel(`Pengirim : Ashal Store
Penerima : Budi S
LAMPUNG,LAMPUNG SELATAN,PENENGAHAN
`);
    expect(r.senderArea).toBeNull();
    expect(r.recipientArea).toBe("LAMPUNG,LAMPUNG SELATAN,PENENGAHAN");
  });

  it("reads the shipment's own details", () => {
    const r = parseShippingLabel(REAL_LABEL);
    expect(r.courier).toBe("J&T");
    expect(r.service).toBe("ECO");
    expect(r.marketplace).toBe("tokopedia");
    expect(r.weightKg).toBe(0.159);
    expect(r.cod).toBe(true);
    expect(r.sortCode).toBe("260-BKH08-05");
    expect(r.shipDate).toBe("04-08-2026");
  });

  it("reads the marketplace's identifiers", () => {
    const r = parseShippingLabel(REAL_LABEL);
    expect(r.orderNo).toBe("585358045683221740");
    expect(r.packageId).toBe("1205938906612515436");
    expect(r.buyerNickname).toBe("dapurneva");
    expect(r.qtyTotal).toBe(1);
  });

  it("converts a weight printed in grams", () => {
    expect(parseShippingLabel("Berat: 250 gr").weightKg).toBe(0.25);
    // A misplaced decimal point would give a parcel a weight no courier
    // accepts; better to report nothing than to report two tonnes.
    expect(parseShippingLabel("Wght 999999 KG").weightKg).toBeNull();
  });

  it("distinguishes non-COD from COD", () => {
    expect(parseShippingLabel("NON COD").cod).toBe(false);
    expect(parseShippingLabel("Pengirim : Toko A").cod).toBeNull();
  });

  it("does not read a landmark in an address as the sending shop", () => {
    // "dari" is one of the commonest words in Indonesian and appears mid
    // address; treating it as a sender label made the landmark the shop name.
    const r = parseShippingLabel("Jl. Anak Air No.60, 800m dari Simpang Anak Air\n");
    expect(r.senderName).toBeNull();
  });

  it("leaves the fine print null when OCR returns noise", () => {
    // What the reader actually produces on these photographs. Every field has
    // to survive it as null rather than latching onto a fragment.
    const r = parseShippingLabel(`bos IT] sdr Mb Ba
iy bo | Pengirim sda Ai RTHANTRIK Jan dl or 3 Gel AE 3
histor 1d AANG A11 ness) ALI se ra BERUEIEA AE A Ti Casa si
Sina Mawsatirs Col Mini Meuihapray Li oe mi SIE, 1 ai oi AA
`);
    expect(r.orderNo).toBeNull();
    expect(r.packageId).toBeNull();
    expect(r.sortCode).toBeNull();
    expect(r.recipient).toBeNull();
    expect(r.qtyTotal).toBeNull();
  });
});
