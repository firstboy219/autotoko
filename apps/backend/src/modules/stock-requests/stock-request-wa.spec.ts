import { describe, expect, it } from "vitest";
import {
  angkaRapi,
  barisItem,
  pesanRequest,
  totalDari,
  type ItemRequest,
} from "./stock-request-wa.js";

/**
 * Yang dikirim ke pemasok tidak bisa ditarik kembali, dan satu angka yang
 * salah di sini berarti barang yang salah datang seminggu kemudian.
 */
describe("pesan permintaan pembelian stok", () => {
  const aquades: ItemRequest = {
    nama: "Aquades",
    qtyPack: 2, packLabel: "botol",
    contentPerPack: 1, contentUnit: "liter",
    qtyBase: 2000, baseUnit: "ml",
    unitPrice: 15000, totalPrice: 30000,
  };

  it("menulis satuan penjual DAN satuan rak", () => {
    // Pemasok menjual "2 botol", rak menghitung "2.000 ml". Menulis salah
    // satunya saja memindahkan penerjemahan ke orang yang tidak punya
    // datanya.
    const b = barisItem(aquades, 1);
    expect(b[0]).toBe("1. Aquades — 2 botol × 1 liter (= 2.000 ml)");
    expect(b[1]).toBe("   Rp 15.000/botol · Rp 30.000");
  });

  it("angka tidak ditulis dengan nol desimal yang tidak berguna", () => {
    expect(angkaRapi(2)).toBe("2");
    expect(angkaRapi(2000)).toBe("2.000");
    expect(angkaRapi(0.5)).toBe("0,5");
  });

  it("baris harga hilang kalau harganya belum diisi", () => {
    // "Rp 0" untuk barang yang harganya belum diketahui membuat pemasok
    // mengira itu gratis.
    const b = barisItem({ ...aquades, unitPrice: null, totalPrice: null }, 1);
    expect(b).toHaveLength(1);
    expect(b[0]).not.toContain("Rp");
  });

  it("bahan tanpa isi kemasan tetap terbaca", () => {
    const b = barisItem({
      nama: "Kardus Packing", qtyPack: 50, packLabel: "pcs",
      contentPerPack: null, contentUnit: null,
      qtyBase: 50, baseUnit: "pcs",
      unitPrice: 1200, totalPrice: 60000,
    }, 3);
    expect(b[0]).toBe("3. Kardus Packing — 50 pcs (= 50 pcs)");
  });

  it("kemasan yang tidak disebut jatuh ke pcs", () => {
    const b = barisItem({ ...aquades, packLabel: null }, 1);
    expect(b[0]).toContain("2 pcs");
  });

  it("pesan utuh memuat total dan cara bayarnya", () => {
    const t = pesanRequest({
      items: [aquades, {
        nama: "Botol Spray 100ml", qtyPack: 30, packLabel: "pcs",
        contentPerPack: null, contentUnit: null,
        qtyBase: 30, baseUnit: "pcs",
        unitPrice: 2500, totalPrice: 75000,
      }],
      tanggal: new Date("2026-08-31T00:00:00Z"),
    });
    expect(t).toContain("*Permintaan Pembelian Stok*");
    expect(t).toContain("Tanggal: 31 Agustus 2026");
    expect(t).toContain("1. Aquades");
    expect(t).toContain("2. Botol Spray 100ml");
    expect(t).toContain("*Total: Rp 105.000*");
    // Fitur ini memang untuk pembelian non-COD, dan pemasok yang mengira COD
    // akan mengirim kurir penagih.
    expect(t).toContain("Pembayaran: transfer (non-COD).");
  });

  it("harga yang belum lengkap dikatakan, bukan didiamkan", () => {
    const t = pesanRequest({
      items: [{ ...aquades, unitPrice: null, totalPrice: null }],
      tanggal: new Date("2026-08-31T00:00:00Z"),
    });
    expect(t).not.toContain("*Total:");
    expect(t).toContain("_Harga belum diisi seluruhnya._");
  });

  it("catatan dan tautan bukti ikut kalau ada", () => {
    const t = pesanRequest({
      items: [aquades],
      catatan: "  tolong kirim sebelum Jumat  ",
      tautanBukti: "https://viewtoko.cosger.online/api/uploads/x.jpg",
      tanggal: new Date("2026-08-31T00:00:00Z"),
    });
    expect(t).toContain("Catatan: tolong kirim sebelum Jumat");
    expect(t).toContain("Tangkapan layar: https://viewtoko.cosger.online/api/uploads/x.jpg");
  });

  it("tanpa bahan sama sekali tetap pesan yang bisa dibaca", () => {
    const t = pesanRequest({ items: [], tanggal: new Date("2026-08-31T00:00:00Z") });
    expect(t).toContain("(belum ada bahan yang dipilih)");
    expect(t).not.toContain("undefined");
    expect(t).not.toContain("NaN");
  });

  it("total dihitung dari baris, bukan dari layar", () => {
    expect(totalDari([aquades, { ...aquades, totalPrice: 5000 }])).toBe(35000);
    expect(totalDari([{ ...aquades, totalPrice: null }])).toBe(0);
    expect(totalDari([])).toBe(0);
  });
});
