import { describe, it, expect } from "vitest";
import {
  hitungSince,
  kelompokkanItem,
  majukanStatus,
  petakanPesanan,
  petakanProduk,
  statusInternal,
} from "./peta-tiktok";

/**
 * Bentuk yang dipakai di sini disalin dari pesanan SUNGGUHAN toko Bulanjacom
 * (id 586039731474629791, September 2026), dengan data pembeli diganti.
 * Bukan dari dokumentasi: dokumentasi tidak menyebut bahwa tiap unit jadi
 * satu line_item, dan itu justru aturan terpenting di berkas ini.
 */
const PESANAN_ASLI = {
  id: "586039731474629791",
  status: "AWAITING_COLLECTION",
  commerce_platform: "TOKOPEDIA",
  create_time: 1789248875,
  update_time: 1789274649,
  paid_time: 1789248884,
  tracking_number: "JY1649738608",
  shipping_provider: "J&T Express",
  payment_method_name: "GoPay",
  payment: {
    currency: "IDR",
    original_shipping_fee: "20500",
    original_total_product_price: "49300",
    shipping_fee: "0",
    sub_total: "49300",
    total_amount: "50300",
  },
  recipient_address: {
    name: "Pembeli Uji",
    phone_number: "(+62)8123****",
    full_address: "Jl. Contoh No. 1, Surakarta",
    postal_code: "57***",
    region_code: "ID",
  },
  line_items: [
    {
      id: "586039731474695327",
      product_id: "1730742891503715813",
      product_name: "Renature Duo Inhaler COOL MINT",
      sku_id: "1731335224096884197",
      sku_name: "Cool Mint",
      seller_sku: "",
      sale_price: "49300",
      original_price: "49300",
      tracking_number: "JY1649738608",
      display_status: "AWAITING_COLLECTION",
    },
  ],
};

describe("kelompokkanItem", () => {
  it("dua line_item ber-SKU sama adalah SATU produk berjumlah dua", () => {
    // Inilah jebakan utamanya. Tanpa pengelompokan, pesanan dua unit terbaca
    // sebagai dua produk berbeda, dan jumlah unit di dashboard salah dua kali.
    const item = kelompokkanItem([
      { sku_id: "A", product_name: "Inhaler", sale_price: "39300" },
      { sku_id: "A", product_name: "Inhaler", sale_price: "39300" },
      { sku_id: "B", product_name: "Siwak", sale_price: "49300" },
    ]);
    expect(item).toHaveLength(2);
    expect(item[0]).toMatchObject({ skuId: "A", qty: 2, salePrice: 39300, subtotal: 78600 });
    expect(item[1]).toMatchObject({ skuId: "B", qty: 1, subtotal: 49300 });
  });

  it("subtotal dijumlah per unit meski harganya berbeda", () => {
    // Promo bertingkat: unit kedua lebih murah. Uangnya harus tetap benar.
    const [x] = kelompokkanItem([
      { sku_id: "A", sale_price: "40000" },
      { sku_id: "A", sale_price: "30000" },
    ]);
    expect(x!.qty).toBe(2);
    expect(x!.subtotal).toBe(70000);
  });

  it("tanpa sku_id jatuh ke product_id, lalu ke id line item", () => {
    const item = kelompokkanItem([
      { product_id: "P1", sale_price: "1" },
      { product_id: "P1", sale_price: "1" },
      { id: "L9", sale_price: "1" },
    ]);
    expect(item.map((x) => [x.productId ?? x.skuId, x.qty])).toEqual([["P1", 2], [null, 1]]);
  });

  it("kosong tetap aman", () => {
    expect(kelompokkanItem(null)).toEqual([]);
    expect(kelompokkanItem(undefined)).toEqual([]);
  });
});

describe("statusInternal & majukanStatus", () => {
  it("memetakan status TikTok ke tahap gudang", () => {
    expect(statusInternal("UNPAID")).toBe("masuk");
    expect(statusInternal("AWAITING_SHIPMENT")).toBe("masuk");
    expect(statusInternal("AWAITING_COLLECTION")).toBe("packing");
    expect(statusInternal("IN_TRANSIT")).toBe("dikirim");
    expect(statusInternal("COMPLETED")).toBe("selesai");
    expect(statusInternal("CANCELLED")).toBe("dibatalkan");
  });

  it("status yang tidak dikenal tidak menghentikan sinkronisasi", () => {
    expect(statusInternal("SESUATU_YANG_BARU")).toBe("masuk");
    expect(statusInternal(null)).toBe("masuk");
  });

  it("tidak menarik mundur tahap yang sudah dimajukan gudang", () => {
    // Gudang sudah menandai "packing"; marketplace masih AWAITING_SHIPMENT.
    expect(majukanStatus("packing", "approved")).toBe("packing");
    // Marketplace maju melewati gudang: ikut maju.
    expect(majukanStatus("packing", "dikirim")).toBe("dikirim");
  });

  it("terminal selalu menang, ke dua arah", () => {
    expect(majukanStatus("packing", "dibatalkan")).toBe("dibatalkan");
    expect(majukanStatus("selesai", "dikirim")).toBe("selesai");
    expect(majukanStatus("dibatalkan", "approved")).toBe("dibatalkan");
  });

  it("baris baru memakai status marketplace apa adanya", () => {
    expect(majukanStatus(null, "siap_kirim")).toBe("siap_kirim");
  });
});

describe("petakanPesanan", () => {
  it("pesanan asli terpetakan lengkap", () => {
    const b = petakanPesanan(PESANAN_ASLI as never);
    expect(b.marketplaceOrderId).toBe("586039731474629791");
    expect(b.status).toBe("AWAITING_COLLECTION");
    expect(b.fulfillmentStatus).toBe("siap_kirim");
    expect(b.commercePlatform).toBe("TOKOPEDIA");
    expect(b.trackingNumber).toBe("JY1649738608");
    expect(b.shippingCourier).toBe("J&T Express");
    expect(b.buyerName).toBe("Pembeli Uji");
    expect(b.subtotal).toBe("49300.00");
    expect(b.totalAmount).toBe("50300.00");
    expect(b.shippingFee).toBe("0.00");
    expect(b.createdAtMarketplace?.toISOString()).toBe("2026-09-12T21:34:35.000Z");
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ skuId: "1731335224096884197", qty: 1, salePrice: 49300 });
    expect(b.raw).toBe(PESANAN_ASLI);
  });

  it("uang disimpan sebagai string desimal, bukan float", () => {
    // Kolomnya numeric. Float bolak-balik adalah cara kehilangan sen.
    const b = petakanPesanan({ id: "1", payment: { total_amount: 12345.678 } } as never);
    expect(b.totalAmount).toBe("12345.68");
  });

  it("nomor resi diambil dari line item bila di pesanan kosong", () => {
    const b = petakanPesanan({
      id: "1", tracking_number: "",
      line_items: [{ sku_id: "A", tracking_number: "" }, { sku_id: "B", tracking_number: "JX123" }],
    } as never);
    expect(b.trackingNumber).toBe("JX123");
  });

  it("nilai kosong jadi null, bukan string kosong atau NaN", () => {
    const b = petakanPesanan({ id: "1" } as never);
    expect(b.buyerName).toBeNull();
    expect(b.totalAmount).toBeNull();
    expect(b.createdAtMarketplace).toBeNull();
    expect(b.items).toEqual([]);
  });
});

describe("petakanProduk", () => {
  it("produk asli beserta SKU dan stok lintas gudang", () => {
    const { produk, skus } = petakanProduk({
      id: "1734996990353507813",
      title: "OVERMODE - Minyak Rambut",
      status: "SELLER_DEACTIVATED",
      update_time: 1786726440,
      skus: [{
        id: "1734996985655952869",
        seller_sku: "",
        price: { currency: "IDR", tax_exclusive_price: "22150" },
        inventory: [{ quantity: 9999, warehouse_id: "w1" }, { quantity: 1, warehouse_id: "w2" }],
      }],
    });
    expect(produk).toMatchObject({ productId: "1734996990353507813", status: "SELLER_DEACTIVATED" });
    expect(skus).toHaveLength(1);
    expect(skus[0]).toMatchObject({ skuId: "1734996985655952869", sellerSku: null, price: "22150.00", stock: 10000 });
  });

  it("tanpa inventory, stok null -- 'tidak tahu' bukan 'nol'", () => {
    const { skus } = petakanProduk({ id: "1", skus: [{ id: "s" }] });
    expect(skus[0]!.stock).toBeNull();
    expect(skus[0]!.price).toBeNull();
  });
});

describe("hitungSince", () => {
  it("mundur satu jam dari watermark supaya batas detik tidak melewatkan pesanan", () => {
    const w = new Date("2026-09-13T10:00:00Z");
    expect(hitungSince(w)?.toISOString()).toBe("2026-09-13T09:00:00.000Z");
  });

  it("tanpa watermark berarti tarik semua", () => {
    expect(hitungSince(null)).toBeNull();
  });
});
