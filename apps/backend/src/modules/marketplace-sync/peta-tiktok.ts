/**
 * Menerjemahkan JSON TikTok Shop menjadi baris tabel. Murni, tanpa I/O, supaya
 * setiap aturannya bisa diuji dengan pesanan sungguhan yang dibekukan.
 *
 * DUA HAL YANG TIDAK KELIHATAN DARI DOKUMENTASI dan hanya ketahuan dari
 * membaca pesanan asli:
 *
 * 1. TikTok MEMECAH tiap unit jadi satu line_item. Pesanan "2 x Inhaler"
 *    datang sebagai dua line_item dengan sku_id yang sama. Membaca panjang
 *    array sebagai "jumlah jenis produk" menghasilkan angka yang salah dua
 *    kali lipat pada setiap pesanan lebih dari satu unit.
 *
 * 2. Satu toko TikTok Shop memuat pesanan TOKOPEDIA juga (commerce_platform).
 *    Potongan keduanya terukur berbeda -- 42% lawan 36% -- jadi asalnya
 *    disimpan, bukan disamaratakan sebagai "tiktok".
 */

export type StatusInternal =
  | "masuk" | "approved" | "produksi" | "packing" | "siap_kirim"
  | "dikirim" | "selesai" | "retur" | "dibatalkan";

/** Urutan maju. Status hanya boleh bergerak ke kanan, kecuali ke terminal. */
const URUTAN: StatusInternal[] = [
  "masuk", "approved", "produksi", "packing", "siap_kirim", "dikirim", "selesai",
];
const TERMINAL = new Set<StatusInternal>(["selesai", "retur", "dibatalkan"]);

/**
 * Status marketplace -> status internal.
 *
 * Yang tidak dikenal jatuh ke "masuk", bukan dilempar: satu status baru dari
 * TikTok tidak boleh menghentikan sinkronisasi seluruh toko.
 */
/**
 * Auto-setujui / auto-proses: order BARU (masuk = menunggu disetujui) langsung
 * dinaikkan ke approved (menunggu dicetak) saat sync, agar tim tak perlu
 * menyetujui satu per satu. Ini gate INTERNAL AutoToko; di marketplace order
 * tetap "siap kirim". Kurir instant/sameday dikecualikan (butuh keputusan
 * manual cepat). Hanya menyentuh tahap "masuk"; forward-only tetap berlaku.
 */
export function autoProses(
  status: StatusInternal,
  courier: string | null | undefined,
  cfg: { autoProses?: boolean; instantCouriers?: string[] } | null | undefined,
): StatusInternal {
  if (!cfg?.autoProses) return status;
  if (status !== "masuk") return status;
  const c = (courier ?? "").toLowerCase();
  const instant = (cfg.instantCouriers ?? []).some((k) => k && c.includes(k.toLowerCase()));
  if (instant) return status;
  return majukanStatus(status, "approved");
}

export function statusInternal(mp: string | null | undefined): StatusInternal {
  switch (String(mp ?? "").toUpperCase()) {
    case "UNPAID":
    case "ON_HOLD":
      return "masuk";
    case "AWAITING_SHIPMENT":
      // Pesanan baru berbayar yang BELUM ditangani seller -> tahap awal
      // internal "menunggu disetujui" (masuk). Seller yang menyetujuinya di
      // AutoToko (masuk -> approved); forward-only menjaga yang sudah maju.
      return "masuk";
    case "AWAITING_COLLECTION":
      // Resi/label sudah dicetak & menunggu kurir -> di alur seller ini
      // artinya paket MULAI dikemas. forward-only menjaga yang sudah lebih
      // maju (siap_kirim/dikirim) tidak ditarik mundur.
      return "packing";
    case "PARTIALLY_SHIPPING":
    case "IN_TRANSIT":
      return "dikirim";
    case "DELIVERED":
    case "COMPLETED":
      return "selesai";
    case "CANCELLED":
    case "CANCELED":
      return "dibatalkan";
    default:
      return "masuk";
  }
}

/**
 * Status yang dipakai setelah sinkronisasi, diberi status yang sekarang
 * tersimpan dan status baru dari marketplace.
 *
 * HANYA MAJU. Orang di gudang boleh menandai "produksi" atau "packing" lewat
 * aplikasi sebelum marketplace tahu apa-apa; sinkronisasi berikutnya yang
 * masih membaca AWAITING_SHIPMENT tidak boleh menariknya mundur ke
 * "approved". Terminal (selesai/retur/batal) selalu menang: itu kata akhir
 * marketplace, dan tidak ada tahap gudang yang membatalkannya.
 */
export function majukanStatus(
  sekarang: StatusInternal | null | undefined,
  baru: StatusInternal,
): StatusInternal {
  if (!sekarang) return baru;
  if (TERMINAL.has(baru)) return baru;
  if (TERMINAL.has(sekarang)) return sekarang;
  const a = URUTAN.indexOf(sekarang);
  const b = URUTAN.indexOf(baru);
  return b > a ? baru : sekarang;
}

export interface LineItemTikTok {
  id?: string;
  product_id?: string;
  product_name?: string;
  sku_id?: string;
  sku_name?: string;
  seller_sku?: string;
  sale_price?: string | number;
  original_price?: string | number;
  tracking_number?: string;
  display_status?: string;
  /** URL gambar varian dari marketplace; dipakai sebagai thumbnail pesanan. */
  sku_image?: string;
}

export interface ItemPesanan {
  skuId: string | null;
  productId: string | null;
  name: string;
  skuName: string | null;
  sellerSku: string | null;
  /** Thumbnail varian (URL) dari marketplace, bila tersedia. */
  skuImage: string | null;
  qty: number;
  /** Harga satuan yang dibayar pembeli, rupiah. */
  salePrice: number;
  subtotal: number;
}

/**
 * Line item yang dipecah per unit dikelompokkan kembali per SKU.
 *
 * Harga diambil dari item pertama tiap SKU; kalau TikTok memberi harga
 * berbeda untuk unit yang sama (promo bertingkat), subtotal tetap dijumlah
 * dari tiap unit supaya uangnya benar meski "harga satuan"-nya jadi rata-rata
 * yang tidak persis.
 */
export function kelompokkanItem(items: readonly LineItemTikTok[] | null | undefined): ItemPesanan[] {
  const per = new Map<string, ItemPesanan>();
  for (const it of items ?? []) {
    const kunci = it.sku_id || it.product_id || it.id || "?";
    const harga = angka(it.sale_price);
    const ada = per.get(kunci);
    if (ada) {
      ada.qty += 1;
      ada.subtotal += harga;
      continue;
    }
    per.set(kunci, {
      skuId: it.sku_id || null,
      productId: it.product_id || null,
      name: it.product_name || it.sku_name || "(tanpa nama)",
      skuName: it.sku_name || null,
      sellerSku: it.seller_sku || null,
      skuImage: it.sku_image || null,
      qty: 1,
      salePrice: harga,
      subtotal: harga,
    });
  }
  return [...per.values()];
}

export interface PesananTikTok {
  id: string;
  status?: string;
  commerce_platform?: string;
  create_time?: number;
  update_time?: number;
  paid_time?: number;
  tracking_number?: string;
  shipping_provider?: string;
  payment_method_name?: string;
  payment?: {
    currency?: string;
    sub_total?: string | number;
    shipping_fee?: string | number;
    total_amount?: string | number;
    platform_discount?: string | number;
    seller_discount?: string | number;
  };
  recipient_address?: {
    name?: string;
    phone_number?: string;
    full_address?: string;
    postal_code?: string;
    region_code?: string;
    district_info?: unknown;
  };
  line_items?: LineItemTikTok[];
  [k: string]: unknown;
}

export interface BarisPesanan {
  marketplaceOrderId: string;
  status: string | null;
  fulfillmentStatus: StatusInternal;
  buyerName: string | null;
  buyerPhone: string | null;
  shippingAddress: unknown;
  shippingCourier: string | null;
  trackingNumber: string | null;
  paymentMethod: string | null;
  subtotal: string | null;
  shippingFee: string | null;
  totalAmount: string | null;
  items: ItemPesanan[];
  createdAtMarketplace: Date | null;
  updatedAtMarketplace: Date | null;
  commercePlatform: string | null;
  raw: unknown;
}

/**
 * Satu pesanan TikTok -> satu baris orders (tanpa user/shop; itu urusan
 * pemanggil). Angka uang disimpan sebagai string desimal karena kolomnya
 * numeric -- mengubahnya ke float lalu kembali adalah cara kehilangan sen.
 */
export function petakanPesanan(o: PesananTikTok): BarisPesanan {
  const p = o.payment ?? {};
  const alamat = o.recipient_address ?? null;
  // Nomor resi: TikTok menaruhnya di pesanan DAN di tiap line item. Yang di
  // pesanan bisa kosong pada pesanan multi-paket; ambil yang mana pun ada.
  const resi = o.tracking_number
    || (o.line_items ?? []).map((x) => x.tracking_number).find((x) => !!x)
    || null;
  return {
    marketplaceOrderId: String(o.id),
    status: o.status ?? null,
    fulfillmentStatus: statusInternal(o.status),
    buyerName: alamat?.name || null,
    buyerPhone: alamat?.phone_number || null,
    shippingAddress: alamat,
    shippingCourier: o.shipping_provider || null,
    trackingNumber: resi,
    paymentMethod: o.payment_method_name || null,
    subtotal: desimal(p.sub_total),
    shippingFee: desimal(p.shipping_fee),
    totalAmount: desimal(p.total_amount),
    items: kelompokkanItem(o.line_items),
    createdAtMarketplace: detik(o.create_time),
    updatedAtMarketplace: detik(o.update_time),
    commercePlatform: o.commerce_platform || null,
    raw: o,
  };
}

export interface ProdukTikTok {
  id: string;
  title?: string;
  status?: string;
  update_time?: number;
  skus?: {
    id: string;
    seller_sku?: string;
    price?: { currency?: string; tax_exclusive_price?: string | number; sale_price?: string | number };
    inventory?: { quantity?: number; warehouse_id?: string }[];
  }[];
  [k: string]: unknown;
}

export interface BarisProduk {
  productId: string;
  title: string | null;
  status: string | null;
  updatedAtMarketplace: Date | null;
  raw: unknown;
}

export interface BarisSku {
  productId: string;
  skuId: string;
  sellerSku: string | null;
  price: string | null;
  currency: string | null;
  stock: number | null;
  raw: unknown;
}

export function petakanProduk(p: ProdukTikTok): { produk: BarisProduk; skus: BarisSku[] } {
  const produk: BarisProduk = {
    productId: String(p.id),
    title: p.title ?? null,
    status: p.status ?? null,
    updatedAtMarketplace: detik(p.update_time),
    raw: p,
  };
  const skus: BarisSku[] = (p.skus ?? []).map((s) => ({
    productId: String(p.id),
    skuId: String(s.id),
    sellerSku: s.seller_sku || null,
    price: desimal(s.price?.sale_price ?? s.price?.tax_exclusive_price),
    currency: s.price?.currency ?? null,
    // Stok dijumlahkan lintas gudang. Null bila TikTok tidak mengirim
    // inventory sama sekali -- itu "tidak tahu", bukan "nol".
    stock: s.inventory ? s.inventory.reduce((a, i) => a + (Number(i.quantity) || 0), 0) : null,
    raw: s,
  }));
  return { produk, skus };
}

/**
 * Batas bawah update_time untuk run berikutnya.
 *
 * Diambil dari watermark run terakhir yang berhasil, dimundurkan sedikit
 * (tumpang tindih): pesanan yang berubah tepat di detik yang sama dengan
 * watermark bisa terlewat oleh perbandingan "lebih besar dari", dan
 * tumpang tindih murah sedangkan pesanan yang hilang mahal. Upsert membuat
 * pengulangan tidak berbahaya.
 */
export function hitungSince(
  watermarkTerakhir: Date | null | undefined,
  tumpangTindihDetik = 3600,
): Date | null {
  if (!watermarkTerakhir) return null;
  return new Date(watermarkTerakhir.getTime() - tumpangTindihDetik * 1000);
}

/* ------------------------------------------------------------ pembantu */

function angka(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** "49300" tetap "49300"; 49300.5 jadi "49300.50"; kosong jadi null. */
function desimal(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function detik(v: unknown): Date | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}
