import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceProducts,
  marketplaceSkus,
  marketplaceSyncRuns,
  orders,
  shops,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { TenantService } from "../../database/tenant.service.js";
import { TikTokAdapter } from "../../marketplace/adapters/tiktok.adapter.js";
import { ShopsService } from "../shops/shops.service.js";
import { TikTokApiError, TikTokClient } from "./tiktok-client.js";
import {
  hitungSince,
  majukanStatus,
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
  async syncSemua(jenis: JenisSync, pemicu: Pemicu): Promise<{ toko: number; gagal: number }> {
    const daftar = await this.tokoSiap();
    let gagal = 0;
    for (const t of daftar) {
      try {
        if (jenis === "products") await this.syncProduk(t, pemicu);
        else await this.syncPesanan(t, pemicu);
      } catch (e) {
        gagal += 1;
        this.logger.error(`Sync ${jenis} ${t.shopName}: ${(e as Error).message}`);
      }
    }
    return { toko: daftar.length, gagal };
  }

  async riwayat(userId: string, shopId: string, limit = 10) {
    return this.bypass(() => this.db
      .select()
      .from(marketplaceSyncRuns)
      .where(and(eq(marketplaceSyncRuns.userId, userId), eq(marketplaceSyncRuns.shopId, shopId)))
      .orderBy(desc(marketplaceSyncRuns.startedAt))
      .limit(Math.min(50, Math.max(1, limit))));
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
        fulfillmentStatus: majukanStatus(statusLama.get(b.marketplaceOrderId), b.fulfillmentStatus),
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
