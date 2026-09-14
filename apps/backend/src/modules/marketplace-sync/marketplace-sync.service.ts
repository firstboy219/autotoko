import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceCatalogs,
  orderSettings,
  marketplaceProducts,
  marketplaceSkus,
  marketplaceSyncRuns,
  orders,
  shops,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { TenantService } from "../../database/tenant.service.js";
import { TikTokAdapter } from "../../marketplace/adapters/tiktok.adapter.js";
import { EventsGateway } from "../events/events.gateway.js";
import { ShopsService } from "../shops/shops.service.js";
import { TikTokApiError, TikTokClient } from "./tiktok-client.js";
import {
  hitungSince,
  majukanStatus,
  autoSiapKirim,
  petakanPesanan,
  petakanProduk,
  type PesananTikTok,
  type ProdukTikTok,
  type StatusInternal,
} from "./peta-tiktok.js";

export type JenisSync = "orders" | "products";
export type Pemicu = "cron" | "manual";

/**
 * Batas halaman per run. Seratus pesanan per halaman, jadi 200 halaman = 20.000
 * pesanan -- dua kali lipat toko terbesar hari ini (9.045). Bukan untuk
 * membatasi data, melainkan untuk memastikan satu run yang macet karena
 * page_token yang berputar tidak berjalan selamanya.
 */
const MAKS_HALAMAN = 200;
/** Jeda antar halaman. TikTok membatasi laju; lebih baik pelan daripada ditolak. */
const JEDA_MS = 250;

type Toko = typeof shops.$inferSelect;

/**
 * Menarik pesanan dan produk dari TikTok Shop ke tabel milik marketplace.
 *
 * TIDAK PERNAH menulis ke payout_mutations, resi_scans, atau material_*.
 * Manual tetap sumber yang dipakai menghitung uang; yang ditarik di sini
 * dipakai memeriksanya. Aturan itu ditetapkan pemiliknya dan tidak dibalik.
 *
 * Bertahap: tiap run melanjutkan dari watermark (update_time terbesar) run
 * terakhir yang berhasil, dimundurkan sejam. Upsert membuat tumpang tindih
 * tidak berbahaya, dan watermark dicatat TIAP HALAMAN supaya run yang mati di
 * tengah tetap meninggalkan titik lanjut yang benar.
 */
@Injectable()
export class MarketplaceSyncService {
  private readonly logger = new Logger(MarketplaceSyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly tiktok: TikTokAdapter,
    private readonly shops: ShopsService,
    private readonly tenant: TenantService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Tiap sentuhan basis data dibungkus SENDIRI-SENDIRI di sini, bukan satu
   * transaksi besar untuk seluruh sinkronisasi.
   *
   * KENAPA. Membungkus seluruh sync dalam satu runBypass berarti satu
   * transaksi terbuka selama 91 panggilan HTTP berurutan (terukur 154 detik
   * pada toko 9.045 pesanan) -- menahan satu koneksi pool selama itu, dan
   * membuat baris sync_runs beserta kemajuan per-halaman TIDAK TERLIHAT
   * sampai commit di akhir. Lebih buruk lagi: kalau gagal, rollback menghapus
   * catatan yang justru dibuat untuk bertahan melewati kegagalan.
   *
   * Dengan pembungkusan per-langkah, panggilan HTTP terjadi DI ANTARA
   * transaksi, bukan di dalamnya; kemajuan terlihat saat ditulis; dan run
   * yang gagal meninggalkan barisnya.
   */
  private bypass<T>(fn: () => Promise<T>): Promise<T> {
    return this.tenant.runBypass(fn);
  }

  /* ---------------------------------------------------------- publik */

  /** Toko yang bisa disinkronkan: TikTok, aktif, punya token dan cipher. */
  async tokoSiap(userId?: string): Promise<Toko[]> {
    const syarat = [
      eq(shops.marketplace, "tiktok"),
      eq(shops.shopStatus, "active"),
      isNotNull(shops.accessToken),
      isNotNull(shops.shopCipher),
    ];
    if (userId) syarat.push(eq(shops.userId, userId));
    return this.bypass(() => this.db.select().from(shops).where(and(...syarat)));
  }

  async syncToko(
    shopId: string,
    jenis: JenisSync | "all",
    pemicu: Pemicu,
    userId?: string,
  ): Promise<{ orders?: RingkasanRun; products?: RingkasanRun }> {
    const [toko] = await this.bypass(() => this.db
      .select()
      .from(shops)
      .where(userId ? and(eq(shops.id, shopId), eq(shops.userId, userId)) : eq(shops.id, shopId))
      .limit(1));
    if (!toko) throw new NotFoundException("Toko tidak ditemukan");
    if (toko.marketplace !== "tiktok" || !toko.accessToken || !toko.shopCipher) {
      throw new NotFoundException("Toko ini belum tersambung ke TikTok Shop");
    }
    const hasil: { orders?: RingkasanRun; products?: RingkasanRun } = {};
    // Produk dulu: nama SKU dari produk melengkapi item pesanan yang datang
    // sesudahnya, dan urutan sebaliknya membuat pesanan pertama tanpa nama.
    if (jenis === "products" || jenis === "all") hasil.products = await this.syncProduk(toko, pemicu);
    if (jenis === "orders" || jenis === "all") hasil.orders = await this.syncPesanan(toko, pemicu);
    return hasil;
  }

  /** Semua toko yang siap. Satu toko gagal tidak menghentikan yang lain. */
  async syncSemua(jenis: JenisSync, pemicu: Pemicu): Promise<{ toko: number; gagal: number; upserted: number }> {
    const daftar = await this.tokoSiap();
    let gagal = 0;
    let upserted = 0;
    for (const t of daftar) {
      try {
        const r = jenis === "products"
          ? await this.syncProduk(t, pemicu)
          : await this.syncPesanan(t, pemicu);
        upserted += r.upserted;
      } catch (e) {
        gagal += 1;
        this.logger.error(`Sync ${jenis} ${t.shopName}: ${(e as Error).message}`);
      }
    }
    return { toko: daftar.length, gagal, upserted };
  }

  async riwayat(userId: string, shopId: string, limit = 10) {
    return this.bypass(() => this.db
      .select()
      .from(marketplaceSyncRuns)
      .where(and(eq(marketplaceSyncRuns.userId, userId), eq(marketplaceSyncRuns.shopId, shopId)))
      .orderBy(desc(marketplaceSyncRuns.startedAt))
      .limit(Math.min(50, Math.max(1, limit))));
  }

  /**
   * Menyamakan judul SEMUA postingan aktif dalam satu katalog dengan nama
   * katalog -- langsung menulis judul listing di marketplace lewat API
   * partial_edit. HANYA field title yang dikirim; partial_edit tidak menyentuh
   * field lain, jadi kegagalan bersifat non-destruktif (ditolak, tak berubah).
   *
   * Hanya postingan aktif yang disentuh; sisanya dilewati dengan alasan. Tiap
   * postingan ditangani sendiri (satu gagal tidak menghentikan yang lain),
   * dan token yang ditolak disegarkan sekali lalu diulang. Ini MENULIS ke toko
   * publik pengguna, jadi hanya dipicu manual dari UI dengan konfirmasi.
   */
  async pushCatalogNames(userId: string, catalogId: string) {
    const [cat] = await this.bypass(() => this.db
      .select({ id: marketplaceCatalogs.id, name: marketplaceCatalogs.name })
      .from(marketplaceCatalogs)
      .where(and(eq(marketplaceCatalogs.id, catalogId), eq(marketplaceCatalogs.userId, userId)))
      .limit(1));
    if (!cat) throw new NotFoundException("Katalog tidak ditemukan");
    const title = (cat.name ?? "").trim().slice(0, 255);
    if (!title) throw new BadRequestException("Nama katalog kosong");

    const postings = await this.bypass(() => this.db
      .select({
        productId: marketplaceProducts.productId,
        title: marketplaceProducts.title,
        status: marketplaceProducts.status,
        shopId: marketplaceProducts.shopId,
        marketplace: marketplaceProducts.marketplace,
      })
      .from(marketplaceProducts)
      .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.catalogId, catalogId))));

    const shopIds = [...new Set(postings.map((p) => p.shopId))];
    const shopRows = shopIds.length
      ? await this.bypass(() => this.db.select().from(shops).where(inArray(shops.id, shopIds)))
      : [];
    const shopById = new Map(shopRows.map((s) => [s.id, s] as const));
    const { appKey, appSecret } = await this.tiktok.credentials();
    const clientOf = (shop: typeof shops.$inferSelect) =>
      new TikTokClient(appKey, appSecret, this.crypto.decrypt(shop.accessToken!), shop.shopCipher);

    type Baris = {
      productId: string; shop: string | null; oldTitle: string | null;
      status: "ok" | "skipped" | "failed"; reason?: string; error?: string;
    };
    const hasil: Baris[] = [];
    for (const p of postings) {
      let shop = shopById.get(p.shopId);
      const nama = shop?.shopName ?? null;
      if (!shop || !shop.accessToken || !shop.shopCipher) {
        hasil.push({ productId: p.productId, shop: nama, oldTitle: p.title, status: "skipped", reason: "toko tidak tersambung API" });
        continue;
      }
      if (p.marketplace !== "tiktok") {
        hasil.push({ productId: p.productId, shop: nama, oldTitle: p.title, status: "skipped", reason: `${p.marketplace} belum didukung` });
        continue;
      }
      if (String(p.status ?? "").toUpperCase() !== "ACTIVATE") {
        hasil.push({ productId: p.productId, shop: nama, oldTitle: p.title, status: "skipped", reason: `status ${p.status ?? "?"} (hanya produk aktif)` });
        continue;
      }
      if ((p.title ?? "") === title) {
        hasil.push({ productId: p.productId, shop: nama, oldTitle: p.title, status: "skipped", reason: "nama sudah sama" });
        continue;
      }
      const path = `/product/202309/products/${p.productId}/partial_edit`;
      try {
        let sudahSegar = false;
        for (;;) {
          try {
            await clientOf(shop).post(path, { title });
            break;
          } catch (e) {
            if (e instanceof TikTokApiError && e.tokenBermasalah && !sudahSegar) {
              sudahSegar = true;
              await this.shops.refreshOne(userId, shop.id);
              const [fresh] = await this.bypass(() => this.db.select().from(shops).where(eq(shops.id, shop!.id)).limit(1));
              if (fresh) { shop = fresh; shopById.set(shop.id, fresh); }
              continue;
            }
            throw e;
          }
        }
        await this.bypass(() => this.db
          .update(marketplaceProducts)
          .set({ title })
          .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.productId, p.productId))));
        hasil.push({ productId: p.productId, shop: nama, oldTitle: p.title, status: "ok" });
      } catch (e) {
        this.logger.warn(`Push nama ${p.productId} (${nama}): ${(e as Error).message}`);
        hasil.push({ productId: p.productId, shop: nama, oldTitle: p.title, status: "failed", error: (e as Error).message });
      }
    }
    return {
      catalogId, name: title, total: postings.length,
      ok: hasil.filter((h) => h.status === "ok").length,
      gagal: hasil.filter((h) => h.status === "failed").length,
      dilewati: hasil.filter((h) => h.status === "skipped").length,
      hasil,
    };
  }

  /* --------------------------------------------------------- pesanan */

  private async syncPesanan(toko: Toko, pemicu: Pemicu): Promise<RingkasanRun> {
    const terakhir = await this.watermarkTerakhir(toko.id, "orders");
    const since = hitungSince(terakhir);
    const run = await this.mulaiRun(toko, "orders", pemicu, since);
    let klien = await this.klien(toko);

    let pageToken: string | null = null;
    let pages = 0, fetched = 0, upserted = 0;
    let watermark: Date | null = terakhir ?? null;
    let sudahSegar = false;

    try {
      // Loop tanpa syarat di kepala: pengulangan halaman setelah token
      // disegarkan harus terjadi juga pada halaman PERTAMA, saat pageToken
      // masih null -- "while (pageToken)" akan diam-diam berhenti di situ.
      for (;;) {
        let hal;
        try {
          hal = await klien.cariPesanan({
            updateTimeGe: since ? Math.floor(since.getTime() / 1000) : undefined,
            pageToken,
          });
        } catch (e) {
          // Token kedaluwarsa disegarkan SEKALI lalu halaman yang sama
          // diulang. Sekali, bukan berulang: kalau token baru pun ditolak,
          // masalahnya bukan kedaluwarsa dan mengulang hanya menunda laporan.
          if (e instanceof TikTokApiError && e.tokenBermasalah && !sudahSegar) {
            sudahSegar = true;
            klien = await this.segarkan(toko);
            continue;
          }
          throw e;
        }
        pages += 1;
        fetched += hal.data.length;

        if (hal.data.length) {
          const n = await this.simpanPesanan(toko, hal.data as PesananTikTok[]);
          upserted += n.upserted;
          if (n.watermark && (!watermark || n.watermark > watermark)) watermark = n.watermark;
        }
        await this.catatKemajuan(run.id, { pages, fetched, upserted, watermark });
        pageToken = hal.nextPageToken;
        if (!pageToken || pages >= MAKS_HALAMAN) break;
        await tidur(JEDA_MS);
      }

      await this.selesaikanRun(run.id, "ok", { pages, fetched, upserted, watermark });
      await this.bypass(() =>
        this.db.update(shops).set({ lastSyncAt: new Date() }).where(eq(shops.id, toko.id)));
      // Dorong ke dashboard yang sedang terbuka -- memakai kanal realtime yang
      // sama dengan webhook, jadi halaman Orders memuat ulang tanpa diklik.
      // Hanya bila ada yang berubah: reload kosong tiap dua menit itu gangguan.
      if (upserted > 0) {
        this.events.emitOrderUpdate(toko.userId, { sync: true, shopId: toko.id, upserted });
      }
      return { runId: run.id, status: "ok", pages, fetched, upserted, watermark, since };
    } catch (e) {
      const pesan = (e as Error).message;
      await this.selesaikanRun(run.id, "failed", { pages, fetched, upserted, watermark, error: pesan });
      this.logger.error(`Sync pesanan ${toko.shopName}: ${pesan}`);
      return { runId: run.id, status: "failed", pages, fetched, upserted, watermark, since, error: pesan };
    }
  }

  /**
   * Satu halaman pesanan -> orders + nama SKU.
   *
   * Status internal dihitung per baris DI SINI, dengan membaca status yang
   * sekarang tersimpan, karena hanya maju: gudang yang sudah menandai
   * "packing" tidak boleh ditarik mundur oleh marketplace yang masih membaca
   * AWAITING_SHIPMENT.
   */
  private async simpanPesanan(toko: Toko, data: PesananTikTok[]) {
    const baris = data.map(petakanPesanan);
    const ids = baris.map((b) => b.marketplaceOrderId);

    // Config auto siap-kirim per seller (default mati -> perilaku tak berubah).
    const [cfg] = await this.bypass(() => this.db
      .select({ autoSiapKirim: orderSettings.autoSiapKirim, instantCouriers: orderSettings.instantCouriers })
      .from(orderSettings)
      .where(eq(orderSettings.userId, toko.userId))
      .limit(1));

    const ada = ids.length
      ? await this.bypass(() => this.db
          .select({ id: orders.marketplaceOrderId, st: orders.fulfillmentStatus })
          .from(orders)
          .where(and(eq(orders.marketplace, toko.marketplace), inArray(orders.marketplaceOrderId, ids))))
      : [];
    const statusLama = new Map(ada.map((r) => [r.id, r.st as StatusInternal]));

    // Dihitung di loop biasa, bukan di dalam .map: TypeScript menyempitkan
    // variabel yang ditulis dari closure menjadi never, dan galatnya tidak
    // menyebut sebab itu sama sekali.
    let watermark: Date | null = null;
    for (const b of baris) {
      const t = b.updatedAtMarketplace;
      if (t && (watermark === null || t.getTime() > watermark.getTime())) watermark = t;
    }
    const nilai = baris.map((b) => {
      return {
        userId: toko.userId,
        shopId: toko.id,
        marketplaceOrderId: b.marketplaceOrderId,
        marketplace: toko.marketplace,
        status: b.status,
        fulfillmentStatus: autoSiapKirim(
          majukanStatus(statusLama.get(b.marketplaceOrderId), b.fulfillmentStatus),
          b.shippingCourier,
          cfg ?? null,
        ),
        buyerName: b.buyerName,
        buyerPhone: b.buyerPhone,
        shippingAddress: b.shippingAddress,
        shippingCourier: b.shippingCourier,
        trackingNumber: b.trackingNumber,
        paymentMethod: b.paymentMethod,
        subtotal: b.subtotal,
        shippingFee: b.shippingFee,
        totalAmount: b.totalAmount,
        items: b.items,
        createdAtMarketplace: b.createdAtMarketplace,
        updatedAtMarketplace: b.updatedAtMarketplace,
        commercePlatform: b.commercePlatform,
        raw: b.raw,
        updatedAt: new Date(),
      };
    });

    if (nilai.length) {
      await this.bypass(() => this.db
        .insert(orders)
        .values(nilai)
        .onConflictDoUpdate({
          target: [orders.marketplace, orders.marketplaceOrderId],
          set: {
            // Kolom yang TIDAK disebut di sini tetap utuh: platform_fee,
            // fee_deducted, awb_generated, label_printed adalah milik
            // AutoToko, bukan milik marketplace, dan sinkronisasi tidak
            // berhak menyentuhnya.
            shopId: sql`excluded.shop_id`,
            status: sql`excluded.status`,
            fulfillmentStatus: sql`excluded.fulfillment_status`,
            buyerName: sql`excluded.buyer_name`,
            buyerPhone: sql`excluded.buyer_phone`,
            shippingAddress: sql`excluded.shipping_address`,
            shippingCourier: sql`excluded.shipping_courier`,
            trackingNumber: sql`excluded.tracking_number`,
            paymentMethod: sql`excluded.payment_method`,
            subtotal: sql`excluded.subtotal`,
            shippingFee: sql`excluded.shipping_fee`,
            totalAmount: sql`excluded.total_amount`,
            items: sql`excluded.items`,
            createdAtMarketplace: sql`excluded.created_at_marketplace`,
            updatedAtMarketplace: sql`excluded.updated_at_marketplace`,
            commercePlatform: sql`excluded.commerce_platform`,
            raw: sql`excluded.raw`,
            updatedAt: sql`excluded.updated_at`,
          },
        }));
    }

    // Nama SKU hanya ada di line item pesanan, bukan di daftar produk. Diisi
    // dari sini, dan tidak ditimpa null oleh sinkronisasi produk sesudahnya.
    const skuNilai = new Map<string, {
      userId: string; shopId: string; marketplace: string; productId: string | null;
      skuId: string; sellerSku: string | null; skuName: string | null; productName: string | null;
    }>();
    for (const b of baris) {
      for (const it of b.items) {
        if (!it.skuId || skuNilai.has(it.skuId)) continue;
        skuNilai.set(it.skuId, {
          userId: toko.userId, shopId: toko.id, marketplace: toko.marketplace,
          productId: it.productId, skuId: it.skuId, sellerSku: it.sellerSku,
          skuName: it.skuName, productName: it.name,
        });
      }
    }
    if (skuNilai.size) {
      await this.bypass(() => this.db
        .insert(marketplaceSkus)
        .values([...skuNilai.values()])
        .onConflictDoUpdate({
          target: [marketplaceSkus.userId, marketplaceSkus.marketplace, marketplaceSkus.skuId],
          set: {
            productId: sql`COALESCE(excluded.product_id, ${marketplaceSkus.productId})`,
            sellerSku: sql`COALESCE(NULLIF(excluded.seller_sku, ''), ${marketplaceSkus.sellerSku})`,
            skuName: sql`COALESCE(excluded.sku_name, ${marketplaceSkus.skuName})`,
            productName: sql`COALESCE(excluded.product_name, ${marketplaceSkus.productName})`,
          },
        }));
    }

    return { upserted: nilai.length, watermark };
  }

  /* ---------------------------------------------------------- produk */

  private async syncProduk(toko: Toko, pemicu: Pemicu): Promise<RingkasanRun> {
    const run = await this.mulaiRun(toko, "products", pemicu, null);
    let klien = await this.klien(toko);
    let pageToken: string | null = null;
    let pages = 0, fetched = 0, upserted = 0;
    let sudahSegar = false;

    try {
      for (;;) {
        let hal;
        try {
          hal = await klien.cariProduk({ pageToken });
        } catch (e) {
          if (e instanceof TikTokApiError && e.tokenBermasalah && !sudahSegar) {
            sudahSegar = true;
            klien = await this.segarkan(toko);
            continue;
          }
          throw e;
        }
        pages += 1;
        fetched += hal.data.length;
        if (hal.data.length) upserted += await this.simpanProduk(toko, hal.data as ProdukTikTok[]);
        await this.catatKemajuan(run.id, { pages, fetched, upserted, watermark: null });
        pageToken = hal.nextPageToken;
        if (!pageToken || pages >= MAKS_HALAMAN) break;
        await tidur(JEDA_MS);
      }

      await this.selesaikanRun(run.id, "ok", { pages, fetched, upserted, watermark: null });
      // Nama varian tidak ada di daftar produk; ambil dari detail untuk produk
      // multi-varian yang namanya masih kosong (aman: hanya mengisi NULL).
      await this.lengkapiNamaVarian(toko).catch((e) =>
        this.logger.warn(`Lengkapi nama varian ${toko.shopName}: ${(e as Error).message}`),
      );
      return { runId: run.id, status: "ok", pages, fetched, upserted, watermark: null, since: null };
    } catch (e) {
      const pesan = (e as Error).message;
      await this.selesaikanRun(run.id, "failed", { pages, fetched, upserted, watermark: null, error: pesan });
      this.logger.error(`Sync produk ${toko.shopName}: ${pesan}`);
      return { runId: run.id, status: "failed", pages, fetched, upserted, watermark: null, since: null, error: pesan };
    }
  }

  private async simpanProduk(toko: Toko, data: ProdukTikTok[]): Promise<number> {
    const dipetakan = data.map(petakanProduk);
    const produk = dipetakan.map((d) => ({
      userId: toko.userId,
      shopId: toko.id,
      marketplace: toko.marketplace,
      productId: d.produk.productId,
      title: d.produk.title,
      status: d.produk.status,
      raw: d.produk.raw,
      updatedAtMarketplace: d.produk.updatedAtMarketplace,
      syncedAt: new Date(),
    }));
    if (produk.length) {
      await this.bypass(() => this.db
        .insert(marketplaceProducts)
        .values(produk)
        .onConflictDoUpdate({
          target: [marketplaceProducts.userId, marketplaceProducts.marketplace, marketplaceProducts.productId],
          set: {
            shopId: sql`excluded.shop_id`,
            title: sql`excluded.title`,
            status: sql`excluded.status`,
            raw: sql`excluded.raw`,
            updatedAtMarketplace: sql`excluded.updated_at_marketplace`,
            syncedAt: sql`excluded.synced_at`,
          },
        }));
    }

    const skus = dipetakan.flatMap((d) =>
      d.skus.map((s) => ({
        userId: toko.userId,
        shopId: toko.id,
        marketplace: toko.marketplace,
        productId: s.productId,
        skuId: s.skuId,
        sellerSku: s.sellerSku,
        // Nama TIDAK ada di daftar produk; judul produk dipakai sebagai
        // product_name, dan sku_name dibiarkan diisi dari pesanan.
        productName: d.produk.title,
        price: s.price,
        currency: s.currency,
        stock: s.stock,
        raw: s.raw,
        syncedAt: new Date(),
      })),
    );
    if (skus.length) {
      await this.bypass(() => this.db
        .insert(marketplaceSkus)
        .values(skus)
        .onConflictDoUpdate({
          target: [marketplaceSkus.userId, marketplaceSkus.marketplace, marketplaceSkus.skuId],
          set: {
            shopId: sql`excluded.shop_id`,
            productId: sql`excluded.product_id`,
            sellerSku: sql`COALESCE(NULLIF(excluded.seller_sku, ''), ${marketplaceSkus.sellerSku})`,
            productName: sql`COALESCE(excluded.product_name, ${marketplaceSkus.productName})`,
            price: sql`excluded.price`,
            currency: sql`excluded.currency`,
            stock: sql`excluded.stock`,
            raw: sql`excluded.raw`,
            syncedAt: sql`excluded.synced_at`,
          },
        }));
    }
    return produk.length;
  }

  /* --------------------------------------------------------- pembantu */

  /** Nama varian dari sales_attributes detail: "A9 Pro", atau "Merah / L". */
  private static namaDariAtribut(
    sku: { sales_attributes?: { name?: string; value_name?: string }[] },
  ): string | null {
    const bagian = (sku.sales_attributes ?? [])
      .map((a) => a.value_name ?? a.name)
      .filter((x): x is string => !!x && x.trim() !== "");
    return bagian.length ? bagian.join(" / ").slice(0, 255) : null;
  }

  /**
   * Melengkapi sku_name yang masih NULL dari endpoint DETAIL produk. Daftar
   * produk TikTok tidak memuat nama varian, sehingga varian yang belum pernah
   * muncul di pesanan tampil memakai judul produk. Di sini sales_attributes
   * ("Warna: Cool Mint" dst) untuk produk MULTI-varian diambil dan mengisi nama
   * yang kosong -- TIDAK PERNAH menimpa nama yang sudah ada (dari pesanan atau
   * input manual). Produk satu-varian tidak diambil detailnya: di marketplace
   * ia memang tak punya nama varian tersendiri. Mengembalikan jumlah sku terisi.
   */
  private async lengkapiNamaVarian(toko: Toko): Promise<number> {
    const grup = await this.bypass(() => this.db
      .select({
        productId: marketplaceSkus.productId,
        n: sql<number>`count(*)::int`,
        kosong: sql<number>`count(*) filter (where ${marketplaceSkus.skuName} is null)::int`,
      })
      .from(marketplaceSkus)
      .where(and(eq(marketplaceSkus.shopId, toko.id), isNotNull(marketplaceSkus.productId)))
      .groupBy(marketplaceSkus.productId));
    const productIds = grup
      .filter((g) => Number(g.n) > 1 && Number(g.kosong) > 0)
      .map((g) => g.productId)
      .filter((x): x is string => !!x);
    if (!productIds.length) return 0;

    let klien = await this.klien(toko);
    let sudahSegar = false;
    let terisi = 0;
    for (const pid of productIds) {
      let detail: { skus?: { id?: string; sales_attributes?: { name?: string; value_name?: string }[] }[] } | null = null;
      try {
        detail = await klien.get(`/product/202309/products/${pid}`);
      } catch (e) {
        if (e instanceof TikTokApiError && e.tokenBermasalah && !sudahSegar) {
          sudahSegar = true;
          klien = await this.segarkan(toko);
          try {
            detail = await klien.get(`/product/202309/products/${pid}`);
          } catch (e2) {
            this.logger.warn(`Detail varian ${pid}: ${(e2 as Error).message}`);
          }
        } else {
          this.logger.warn(`Detail varian ${pid}: ${(e as Error).message}`);
        }
      }
      for (const sk of detail?.skus ?? []) {
        const nama = MarketplaceSyncService.namaDariAtribut(sk);
        if (!nama || !sk.id) continue;
        const diisi = await this.bypass(() => this.db
          .update(marketplaceSkus)
          .set({ skuName: nama })
          .where(and(
            eq(marketplaceSkus.userId, toko.userId),
            eq(marketplaceSkus.skuId, sk.id!),
            isNull(marketplaceSkus.skuName),
          ))
          .returning({ id: marketplaceSkus.id }));
        terisi += diisi.length;
      }
      await tidur(JEDA_MS);
    }
    if (terisi) this.logger.log(`Lengkapi nama varian ${toko.shopName}: ${terisi} terisi`);
    return terisi;
  }

  /** Backfill nama varian untuk semua toko TikTok pengguna (dipicu manual). */
  async perbaikiNamaVarian(userId: string) {
    const toko = await this.tokoSiap(userId);
    const perToko: { toko: string | null; terisi: number }[] = [];
    let terisi = 0;
    for (const t of toko) {
      const n = await this.lengkapiNamaVarian(t).catch((e) => {
        this.logger.warn(`Lengkapi nama varian ${t.shopName}: ${(e as Error).message}`);
        return 0;
      });
      perToko.push({ toko: t.shopName, terisi: n });
      terisi += n;
    }
    return { toko: toko.length, terisi, perToko };
  }

  /** Muat order + tokonya (Toko) untuk operasi fulfillment. */
  /**
   * Batch packing: untuk tiap order terpilih, pastikan sudah RTS (jika belum,
   * arrange shipment), ambil PDF label (base64) + data item, lalu set status
   * lokal ke "packing". Frontend menggabung label jadi 1 PDF & membuat PDF
   * packing list. RTS = tulis outward -> hanya dipicu manual dari batch UI.
   */
  async batchPacking(
    userId: string,
    orderIds: string[],
    opts: { handoverMethod?: string; takeouts?: { orderId: string; reason?: string }[] },
  ) {
    const ids = [...new Set((orderIds ?? []).filter(Boolean))];
    const takeouts = (opts.takeouts ?? []).filter((t) => t?.orderId);
    if (!ids.length && !takeouts.length) throw new BadRequestException("Tidak ada order dipilih");
    // Takeout: order ditahan dari batch (tidak dikirim), alasan dicatat.
    for (const t of takeouts) {
      await this.bypass(() => this.db
        .update(orders)
        .set({ holdReason: (t.reason ?? "").trim() || "(tanpa alasan)", heldAt: new Date(), updatedAt: new Date() })
        .where(and(eq(orders.userId, userId), eq(orders.id, t.orderId))));
    }
    type Baris = { orderId: string; ok: boolean; orderNo: string | null; error?: string };
    const kosong = (oid: string, error: string): Baris => ({ orderId: oid, ok: false, orderNo: null, error });
    const hasil: Baris[] = [];
    const labelBufs: Buffer[] = [];
    // Agregasi item lintas resi untuk packing list: nama -> { qty, resi }.
    const agg = new Map<string, { qty: number; resi: number }>();
    for (const oid of ids) {
      try {
        const [order] = await this.bypass(() => this.db
          .select({
            id: orders.id, shopId: orders.shopId, marketplace: orders.marketplace,
            marketplaceOrderId: orders.marketplaceOrderId, fulfillmentStatus: orders.fulfillmentStatus,
            buyerName: orders.buyerName, shippingCourier: orders.shippingCourier,
            items: orders.items, raw: orders.raw,
          })
          .from(orders)
          .where(and(eq(orders.id, oid), eq(orders.userId, userId)))
          .limit(1));
        if (!order) { hasil.push(kosong(oid, "Order tidak ditemukan")); continue; }
        if (order.marketplace !== "tiktok") { hasil.push(kosong(oid, `${order.marketplace} belum didukung`)); continue; }
        const [toko] = await this.bypass(() => this.db.select().from(shops).where(eq(shops.id, order.shopId)).limit(1));
        if (!toko || !toko.accessToken || !toko.shopCipher) { hasil.push(kosong(oid, "Toko tidak tersambung API")); continue; }
        const pkgIds = this.packageIds(order.raw);
        if (!pkgIds.length) { hasil.push(kosong(oid, "Order belum punya paket")); continue; }

        let klien = await this.klien(toko);
        let segar = false;
        const call = async <T>(fn: (c: TikTokClient) => Promise<T>): Promise<T> => {
          for (;;) {
            try { return await fn(klien); }
            catch (e) {
              if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(toko); continue; }
              throw e;
            }
          }
        };
        for (const pid of pkgIds) {
          const ambilLabel = () => call((c) => c.get<{ doc_url?: string; tracking_number?: string }>(
            `/fulfillment/202309/packages/${pid}/shipping_documents`,
            { document_type: "SHIPPING_LABEL", document_size: "A6" }));
          let doc: { doc_url?: string; tracking_number?: string } | null = null;
          try { doc = await ambilLabel(); } catch { doc = null; }
          if (!doc?.doc_url) {
            const body: Record<string, unknown> = {};
            if (opts.handoverMethod) body.handover_method = opts.handoverMethod;
            await call((c) => c.post(`/fulfillment/202309/packages/${pid}/ship`, body));
            doc = await ambilLabel();
          }
          if (doc?.doc_url) {
            const res = await fetch(doc.doc_url);
            labelBufs.push(Buffer.from(await res.arrayBuffer()));
          }
        }
        await this.bypass(() => this.db
          .update(orders)
          .set({ awbGenerated: true, holdReason: null, heldAt: null, fulfillmentStatus: majukanStatus(order.fulfillmentStatus as StatusInternal, "packing"), updatedAt: new Date() })
          .where(and(eq(orders.userId, userId), eq(orders.id, oid))));
        const rawItems = Array.isArray(order.items)
          ? (order.items as { name?: string; skuName?: string; sellerSku?: string; qty?: number }[])
          : [];
        const seen = new Set<string>();
        for (const it of rawItems) {
          const nm = [it.name, it.skuName].filter(Boolean).join(" \u00b7 ") || it.sellerSku || "-";
          const cur = agg.get(nm) ?? { qty: 0, resi: 0 };
          cur.qty += Number(it.qty ?? 1);
          if (!seen.has(nm)) { cur.resi += 1; seen.add(nm); }
          agg.set(nm, cur);
        }
        hasil.push({ orderId: oid, ok: true, orderNo: order.marketplaceOrderId });
      } catch (e) {
        hasil.push(kosong(oid, (e as Error).message));
      }
    }
    const labelsPdf = await this.gabungLabelPdf(labelBufs);
    const packingListPdf = await this.buatPackingListPdf(agg, hasil.filter((h) => h.ok).length);
    return { total: ids.length, ok: hasil.filter((h) => h.ok).length, ditahan: takeouts.length, labelsPdf, packingListPdf, hasil };
  }

  /** Gabung banyak PDF label jadi satu (pdf-lib) -> base64. Null bila kosong. */
  private async gabungLabelPdf(bufs: Buffer[]): Promise<string | null> {
    if (!bufs.length) return null;
    const out = await PDFDocument.create();
    for (const b of bufs) {
      try {
        const src = await PDFDocument.load(b);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } catch { /* label rusak, lewati */ }
    }
    if (out.getPageCount() === 0) return null;
    return Buffer.from(await out.save()).toString("base64");
  }

  /** Packing list gabungan (qty per produk lintas resi) -> PDF base64. */
  private async buatPackingListPdf(agg: Map<string, { qty: number; resi: number }>, resiCount: number): Promise<string | null> {
    if (agg.size === 0) return null;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 595, H = 842, M = 40;
    let page = doc.addPage([W, H]);
    let y = H - M;
    const clean = (s: string) => s.replace(/\u00b7/g, "-").replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[^\x20-\x7E]/g, "?");
    const text = (s: string, x: number, size: number, f = font) => page.drawText(clean(s), { x, y, size, font: f });
    const nl = (dd = 15) => { y -= dd; if (y < 55) { page = doc.addPage([W, H]); y = H - M; } };
    text("Pick / Packing List", M, 18, bold); nl(16);
    text(`Gabungan ${resiCount} resi - ${agg.size} jenis produk`, M, 9); nl(18);
    const lines = [...agg.entries()].sort((a, b) => b[1].qty - a[1].qty);
    for (const [name, v] of lines) {
      if (y < 55) { page = doc.addPage([W, H]); y = H - M; }
      text(`${v.qty} pcs`, M, 11, bold);
      text(name.length > 62 ? name.slice(0, 61) + "..." : name, M + 60, 10);
      text(`${v.resi} resi`, W - M - 55, 10);
      nl(16);
    }
    return Buffer.from(await doc.save()).toString("base64");
  }

  private async ambilOrderToko(userId: string, orderId: string) {
    const [order] = await this.bypass(() => this.db
      .select({
        id: orders.id,
        shopId: orders.shopId,
        marketplace: orders.marketplace,
        marketplaceOrderId: orders.marketplaceOrderId,
        fulfillmentStatus: orders.fulfillmentStatus,
        raw: orders.raw,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1));
    if (!order) throw new NotFoundException("Order tidak ditemukan");
    if (order.marketplace !== "tiktok") throw new BadRequestException(`${order.marketplace} belum didukung untuk AWB`);
    const [toko] = await this.bypass(() => this.db.select().from(shops).where(eq(shops.id, order.shopId)).limit(1));
    if (!toko || !toko.accessToken || !toko.shopCipher) throw new BadRequestException("Toko tidak tersambung API");
    return { order, toko };
  }

  private packageIds(raw: unknown): string[] {
    const pkgs = (raw as { packages?: { id?: string }[] } | null)?.packages ?? [];
    return pkgs.map((p) => p?.id).filter((x): x is string => !!x);
  }

  /**
   * Ambil dokumen label (AWB) untuk order dari marketplace. READ-ONLY: hanya
   * membaca URL PDF label yang sudah dibuat marketplace, tidak mengubah apa pun.
   * Label baru tersedia setelah paket di-RTS (arrange shipment).
   */
  async labelOrder(userId: string, orderId: string) {
    const { order, toko } = await this.ambilOrderToko(userId, orderId);
    const ids = this.packageIds(order.raw);
    if (!ids.length) throw new BadRequestException("Order belum punya paket di marketplace");
    let klien = await this.klien(toko);
    let sudahSegar = false;
    const hasil: { packageId: string; docUrl: string | null; trackingNumber: string | null; error?: string }[] = [];
    for (const pid of ids) {
      try {
        let doc: { doc_url?: string; tracking_number?: string } | undefined;
        for (;;) {
          try {
            doc = await klien.get(`/fulfillment/202309/packages/${pid}/shipping_documents`, {
              document_type: "SHIPPING_LABEL",
              document_size: "A6",
            });
            break;
          } catch (e) {
            if (e instanceof TikTokApiError && e.tokenBermasalah && !sudahSegar) {
              sudahSegar = true; klien = await this.segarkan(toko); continue;
            }
            throw e;
          }
        }
        hasil.push({ packageId: pid, docUrl: doc?.doc_url ?? null, trackingNumber: doc?.tracking_number ?? null });
      } catch (e) {
        hasil.push({ packageId: pid, docUrl: null, trackingNumber: null, error: (e as Error).message });
      }
    }
    if (hasil.some((h) => h.docUrl)) {
      // Resi berhasil diunduh -> pindah ke "menunggu dipacking".
      await this.bypass(() => this.db
        .update(orders)
        .set({ labelPrinted: true, fulfillmentStatus: majukanStatus(order.fulfillmentStatus as StatusInternal, "packing"), updatedAt: new Date() })
        .where(and(eq(orders.userId, userId), eq(orders.id, orderId))));
    }
    return { orderId, hasil };
  }

  /**
   * RTS / arrange shipment ke marketplace. TULIS & OUTWARD: memindahkan paket
   * ke "menunggu kurir" (AWAITING_COLLECTION) di seller center, memicu AWB &
   * bisa memicu penjemputan. Hanya dipanggil manual dari UI dengan konfirmasi.
   * Setelah semua paket sukses, status lokal dimajukan ke "packing" (menunggu dipacking).
   */
  async shipOrder(userId: string, orderId: string, opts: { handoverMethod?: string }) {
    const { order, toko } = await this.ambilOrderToko(userId, orderId);
    const ids = this.packageIds(order.raw);
    if (!ids.length) throw new BadRequestException("Order belum punya paket di marketplace");
    let klien = await this.klien(toko);
    let sudahSegar = false;
    const hasil: { packageId: string; ok: boolean; error?: string }[] = [];
    for (const pid of ids) {
      const body: Record<string, unknown> = {};
      if (opts.handoverMethod) body.handover_method = opts.handoverMethod;
      try {
        for (;;) {
          try {
            await klien.post(`/fulfillment/202309/packages/${pid}/ship`, body);
            break;
          } catch (e) {
            if (e instanceof TikTokApiError && e.tokenBermasalah && !sudahSegar) {
              sudahSegar = true; klien = await this.segarkan(toko); continue;
            }
            throw e;
          }
        }
        hasil.push({ packageId: pid, ok: true });
      } catch (e) {
        this.logger.warn(`Ship ${orderId} pkg ${pid}: ${(e as Error).message}`);
        hasil.push({ packageId: pid, ok: false, error: (e as Error).message });
      }
    }
    const semuaOk = hasil.length > 0 && hasil.every((h) => h.ok);
    if (semuaOk) {
      await this.bypass(() => this.db
        .update(orders)
        .set({
          awbGenerated: true,
          fulfillmentStatus: majukanStatus(order.fulfillmentStatus as StatusInternal, "packing"),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.userId, userId), eq(orders.id, orderId))));
    }
    return { orderId, ok: semuaOk, hasil };
  }

  private async klien(toko: Toko): Promise<TikTokClient> {
    const { appKey, appSecret } = await this.tiktok.credentials();
    return new TikTokClient(appKey, appSecret, this.crypto.decrypt(toko.accessToken!), toko.shopCipher);
  }

  /** Segarkan token lewat ShopsService (yang tahu cara menyimpannya), lalu klien baru. */
  private async segarkan(toko: Toko): Promise<TikTokClient> {
    this.logger.warn(`Token ${toko.shopName} ditolak; menyegarkan sekali.`);
    // refreshOne mengelola konteks tenant-nya sendiri lewat userId; reload
    // toko sesudahnya perlu bypass karena berjalan di latar tanpa sesi.
    await this.shops.refreshOne(toko.userId, toko.id);
    const [baru] = await this.bypass(() =>
      this.db.select().from(shops).where(eq(shops.id, toko.id)).limit(1));
    if (!baru?.accessToken) throw new Error("Token tidak bisa disegarkan");
    return this.klien(baru);
  }

  private async watermarkTerakhir(shopId: string, jenis: JenisSync): Promise<Date | null> {
    const [r] = await this.bypass(() => this.db
      .select({ w: marketplaceSyncRuns.watermark })
      .from(marketplaceSyncRuns)
      .where(and(
        eq(marketplaceSyncRuns.shopId, shopId),
        eq(marketplaceSyncRuns.kind, jenis),
        // Run yang gagal pun punya watermark yang sah -- ia dicatat per
        // halaman -- jadi tidak disyaratkan status ok. Yang disyaratkan
        // hanya watermark-nya tidak kosong.
        isNotNull(marketplaceSyncRuns.watermark),
      ))
      .orderBy(desc(marketplaceSyncRuns.watermark))
      .limit(1));
    return r?.w ?? null;
  }

  private async mulaiRun(toko: Toko, jenis: JenisSync, pemicu: Pemicu, since: Date | null) {
    const [run] = await this.bypass(() => this.db
      .insert(marketplaceSyncRuns)
      .values({
        userId: toko.userId,
        shopId: toko.id,
        marketplace: toko.marketplace,
        kind: jenis,
        status: "running",
        since,
        triggeredBy: pemicu,
      })
      .returning({ id: marketplaceSyncRuns.id }));
    return run!;
  }

  private async catatKemajuan(
    runId: string,
    k: { pages: number; fetched: number; upserted: number; watermark: Date | null },
  ) {
    await this.bypass(() => this.db
      .update(marketplaceSyncRuns)
      .set({ pages: k.pages, fetched: k.fetched, upserted: k.upserted, watermark: k.watermark })
      .where(eq(marketplaceSyncRuns.id, runId)));
  }

  private async selesaikanRun(
    runId: string,
    status: "ok" | "failed",
    k: { pages: number; fetched: number; upserted: number; watermark: Date | null; error?: string },
  ) {
    await this.bypass(() => this.db
      .update(marketplaceSyncRuns)
      .set({
        status,
        finishedAt: new Date(),
        pages: k.pages,
        fetched: k.fetched,
        upserted: k.upserted,
        watermark: k.watermark,
        error: k.error ?? null,
      })
      .where(eq(marketplaceSyncRuns.id, runId)));
  }
}

export interface RingkasanRun {
  runId: string;
  status: "ok" | "failed";
  pages: number;
  fetched: number;
  upserted: number;
  watermark: Date | null;
  since: Date | null;
  error?: string;
}

function tidur(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
