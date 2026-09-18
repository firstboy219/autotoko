import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { WalletService } from "../billing/wallet.service.js";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceCatalogs,
  marketplaceSkuMap,
  masterProducts,
  orderSettings,
  marketplaceProducts,
  marketplaceSkus,
  marketplaceSyncRuns,
  orders,
  shops,
  marketplaceConversations,
  marketplaceMessages,
  promotionSettings,
  marketplaceReturns,
  autopilotActivity,
  orderBatches,
  marketplaceStatements,
  marketplaceStatementLines,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { TenantService } from "../../database/tenant.service.js";
import { TikTokAdapter } from "../../marketplace/adapters/tiktok.adapter.js";
import { EventsGateway } from "../events/events.gateway.js";
import { ShopsService } from "../shops/shops.service.js";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";
import { UploadsService } from "../uploads/uploads.service.js";
import { TikTokApiError, TikTokClient } from "./tiktok-client.js";
import { parseStatusConfig, deriveStatus } from "./status-config.js";
import {
  hitungSince,
  majukanStatus,
  autoProses,
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
    private readonly uploads: UploadsService,
    private readonly adminSettings: AdminSettingsService,
    private readonly wallet: WalletService,
  ) {}

  private statusMapCache: { at: number; map: Record<string, StatusInternal> } | null = null;
  /** Override pemetaan status dari Admin CMS (order_status_mapping), cache 60s. */
  private async statusOverride(): Promise<Record<string, StatusInternal>> {
    if (this.statusMapCache && Date.now() - this.statusMapCache.at < 60000) return this.statusMapCache.map;
    let map: Record<string, StatusInternal> = {};
    try {
      const raw = await this.adminSettings.get("order_status_config");
      map = deriveStatus(parseStatusConfig(raw)).marketplaceMap as Record<string, StatusInternal>;
    } catch { map = {}; }
    this.statusMapCache = { at: Date.now(), map };
    return map;
  }

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
    const override = await this.statusOverride();
    const baris = data.map((o) => petakanPesanan(o, override));
    const ids = baris.map((b) => b.marketplaceOrderId);

    // Auto-proses (auto-setujui) per seller: order baru langsung disetujui saat
    // sync. Saklarnya memakai kolom lama order_settings.auto_siap_kirim yang
    // di-repurpose (label UI sudah "Auto Setujui/Proses").
    const [cfg] = await this.bypass(() => this.db
      .select({ autoProses: orderSettings.autoSiapKirim, instantCouriers: orderSettings.instantCouriers })
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
    const autoApproved: string[] = [];
    const nilai = baris.map((b) => {
      const fsBase = majukanStatus(statusLama.get(b.marketplaceOrderId), b.fulfillmentStatus);
      // Auto-proses hanya untuk order yang BENAR-BENAR siap diproses
      // (AWAITING_SHIPMENT = sudah dibayar), bukan UNPAID/ON_HOLD yang juga
      // jatuh ke "masuk". Order belum dibayar tidak boleh auto-disetujui.
      const fs =
        (b.status ?? "").toUpperCase() === "AWAITING_SHIPMENT"
          ? autoProses(fsBase, b.shippingCourier, cfg ?? null)
          : fsBase;
      if (fs === "approved" && fsBase !== "approved") autoApproved.push(b.marketplaceOrderId);
      return {
        userId: toko.userId,
        shopId: toko.id,
        marketplaceOrderId: b.marketplaceOrderId,
        marketplace: toko.marketplace,
        status: b.status,
        // siap_kirim HANYA dari scan packing (resi-ocr autoLink); autoProses
        // (di atas) hanya menaikkan order BARU yang sudah dibayar -> approved.
        fulfillmentStatus: fs,
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
        // Tanggal order mengikuti create date bawaan marketplace, bukan waktu
        // sync -- itulah "kapan pesanan terjadi" yang seller kenali. Fallback ke
        // sekarang hanya bila marketplace tak mengirim create_time.
        createdAt: b.createdAtMarketplace ?? new Date(),
        commercePlatform: b.commercePlatform,
        raw: b.raw,
        updatedAt: new Date(),
      };
    });

    if (nilai.length) {
      const upsertRes = await this.bypass(() => this.db
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
            // Selaraskan tanggal order ke create date marketplace (idempoten;
            // sekaligus memperbaiki baris lama yang sempat memakai waktu sync).
            createdAt: sql`COALESCE(excluded.created_at_marketplace, orders.created_at)`,
            commercePlatform: sql`excluded.commerce_platform`,
            raw: sql`excluded.raw`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning({ id: orders.id, inserted: sql<boolean>`(xmax = 0)` }));
      // Billing "order masuk": HANYA order yang benar-benar baru diinsert
      // (xmax=0), bukan update -> tak menagih order lama & tak dobel dgn webhook.
      const baru = upsertRes.filter((rw) => rw.inserted);
      if (baru.length) {
        await this.wallet.billActivity(toko.userId, "order", undefined, baru.length).catch(() => {});
        await this.bypass(() => this.db.update(orders).set({ feeDeducted: true })
          .where(inArray(orders.id, baru.map((rw) => rw.id)))).catch(() => {});
      }
    }

    // Transparansi Autopilot: catat order baru yang OTOMATIS disetujui oleh
    // auto-proses (masuk -> approved). id order internal tak tersedia di jalur
    // bulk ini, jadi no. pesanan disimpan di summary/meta. Best-effort (bypass).
    if (autoApproved.length) {
      await this.bypass(() => this.db.insert(autopilotActivity).values(
        autoApproved.map((no) => ({
          userId: toko.userId,
          feature: "auto_approve",
          action: "approve",
          status: "done" as const,
          summary: `Order ${no} otomatis disetujui (Menunggu Dicetak)`,
          refType: "order",
          meta: { orderNo: no },
        })),
      )).catch(() => {});
    }

    // Auto-Proses ke marketplace: jika seller mengaktifkan auto-proses, order
    // yang baru auto-approved (AWAITING_SHIPMENT, berbayar, BUKAN instant/sameday)
    // langsung di-RTS. Dibatasi 30/run + best-effort. Toggle default OFF.
    if (cfg?.autoProses && autoApproved.length) {
      const perluRts = await this.bypass(() => this.db
        .select({ id: orders.id })
        .from(orders)
        .where(and(
          eq(orders.userId, toko.userId),
          eq(orders.shopId, toko.id),
          inArray(orders.marketplaceOrderId, autoApproved),
          eq(orders.status, "AWAITING_SHIPMENT"),
        )));
      for (const r of perluRts.slice(0, 30)) {
        try { await this.shipOrder(toko.userId, r.id, { handoverMethod: "DROP_OFF" }); }
        catch (e) { this.logger.warn(`Auto-RTS ${r.id}: ${(e as Error).message}`); }
      }
    }

    // Auto-unduh AWB/resi: order yang sudah AWAITING_COLLECTION (label sudah
    // dibuat di marketplace) tapi file resinya belum tersimpan di server kita,
    // diunduh OTOMATIS + dicatat ke Autopilot (bisa dibuka PDF-nya di sana).
    // Dibatasi 20/run, best-effort, hanya membaca dari marketplace.
    try {
      const perluAwb = await this.bypass(() => this.db
        .select({ id: orders.id, no: orders.marketplaceOrderId })
        .from(orders)
        .where(and(
          eq(orders.userId, toko.userId),
          eq(orders.shopId, toko.id),
          eq(orders.status, "AWAITING_COLLECTION"),
          isNull(orders.awbUrl),
        ))
        .limit(20));
      for (const o of perluAwb) {
        try {
          const url = await this.cacheAwb(toko.userId, o.id);
          if (url) {
            await this.bypass(() => this.db.insert(autopilotActivity).values({
              userId: toko.userId,
              feature: "awb",
              action: "auto_unduh",
              status: "done" as const,
              summary: `Resi/AWB order ${o.no} tersimpan otomatis`,
              refType: "order",
              refId: o.id,
              meta: { orderNo: o.no, awbUrl: url },
            })).catch(() => {});
          }
        } catch (e) { this.logger.warn(`Auto-unduh AWB ${o.id}: ${(e as Error).message}`); }
      }
    } catch (e) { this.logger.warn(`Auto-unduh AWB pass: ${(e as Error).message}`); }

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
  /**
   * Batalkan batch (poin 1): bubarkan grup — lepas semua order dari batch &
   * tandai status 'cancelled'. TIDAK menarik balik RTS ke marketplace (tak
   * bisa dibatalkan); ini murni pembatalan pengelompokan di AutoToko.
   */
  async cancelBatch(userId: string, id: string) {
    const [b] = await this.bypass(() => this.db.select().from(orderBatches)
      .where(and(eq(orderBatches.id, id), eq(orderBatches.userId, userId))).limit(1));
    if (!b) throw new NotFoundException("Batch tidak ditemukan");
    await this.bypass(() => this.db.update(orders).set({ batchId: null, updatedAt: new Date() })
      .where(and(eq(orders.userId, userId), eq(orders.batchId, id))));
    await this.bypass(() => this.db.update(orderBatches)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(orderBatches.id, id), eq(orderBatches.userId, userId))));
    return this.getBatch(userId, id);
  }

  /**
   * E: dorong SKU (seller_sku) varian marketplace agar mengikuti SKU master
   * AutoToko hasil mapping. TULISAN KELUAR ke listing TikTok (partial_edit,
   * skus[{id, seller_sku}]). Best-effort; juga menyamakan cache lokal.
   */
  async pushSellerSku(userId: string, skuId: string): Promise<{ ok: boolean; sellerSku?: string; error?: string }> {
    const [sku] = await this.bypass(() => this.db
      .select({ productId: marketplaceSkus.productId, shopId: marketplaceSkus.shopId, marketplace: marketplaceSkus.marketplace })
      .from(marketplaceSkus)
      .where(and(eq(marketplaceSkus.userId, userId), eq(marketplaceSkus.skuId, skuId))).limit(1));
    if (!sku) return { ok: false, error: "SKU tidak ditemukan" };
    if (sku.marketplace !== "tiktok") return { ok: false, error: `${sku.marketplace} belum didukung` };
    if (!sku.productId) return { ok: false, error: "Produk marketplace tak diketahui" };
    const [peta] = await this.bypass(() => this.db
      .select({ mid: marketplaceSkuMap.masterProductId })
      .from(marketplaceSkuMap)
      .where(and(eq(marketplaceSkuMap.userId, userId), eq(marketplaceSkuMap.marketplace, "tiktok"), eq(marketplaceSkuMap.sku, skuId))).limit(1));
    if (!peta) return { ok: false, error: "Varian belum dipetakan ke master" };
    const [master] = await this.bypass(() => this.db
      .select({ sku: masterProducts.sku }).from(masterProducts).where(eq(masterProducts.id, peta.mid)).limit(1));
    if (!master?.sku) return { ok: false, error: "Master tanpa SKU" };
    const [toko] = await this.bypass(() => this.db.select().from(shops).where(eq(shops.id, sku.shopId)).limit(1));
    if (!toko || !toko.accessToken || !toko.shopCipher) return { ok: false, error: "Toko tidak tersambung API" };
    let klien = await this.klien(toko);
    let segar = false;
    const body = { skus: [{ id: skuId, seller_sku: master.sku }] };
    for (;;) {
      try { await klien.post(`/product/202309/products/${sku.productId}/partial_edit`, body); break; }
      catch (e) {
        if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(toko); continue; }
        this.logger.warn(`Push seller_sku ${skuId}: ${(e as Error).message}`);
        return { ok: false, error: (e as Error).message };
      }
    }
    await this.bypass(() => this.db.update(marketplaceSkus).set({ sellerSku: master.sku })
      .where(and(eq(marketplaceSkus.userId, userId), eq(marketplaceSkus.skuId, skuId))));
    return { ok: true, sellerSku: master.sku };
  }

  /** Daftar batch packing (poin 1): tampil di halaman order. orderCount dihitung on-read. */
  async listBatches(userId: string) {
    const rows = await this.bypass(() => this.db.select().from(orderBatches)
      .where(eq(orderBatches.userId, userId)).orderBy(desc(orderBatches.createdAt)).limit(100));
    const counts = await this.bypass(() => this.db
      .select({ bid: orders.batchId, n: sql<number>`count(*)::int` })
      .from(orders).where(and(eq(orders.userId, userId), isNotNull(orders.batchId)))
      .groupBy(orders.batchId));
    const cmap = new Map(counts.map((c) => [c.bid, Number(c.n)]));
    return rows.map((b) => ({ ...b, orderCount: cmap.get(b.id) ?? 0 }));
  }

  async getBatch(userId: string, id: string) {
    const [b] = await this.bypass(() => this.db.select().from(orderBatches)
      .where(and(eq(orderBatches.id, id), eq(orderBatches.userId, userId))).limit(1));
    if (!b) throw new NotFoundException("Batch tidak ditemukan");
    const ord = await this.bypass(() => this.db.select({
      id: orders.id, marketplaceOrderId: orders.marketplaceOrderId,
      shippingCourier: orders.shippingCourier, fulfillmentStatus: orders.fulfillmentStatus,
      buyerName: orders.buyerName, totalAmount: orders.totalAmount,
    }).from(orders).where(and(eq(orders.userId, userId), eq(orders.batchId, id)))
      .orderBy(desc(orders.createdAt)));
    return { ...b, orderCount: ord.length, orders: ord };
  }

  /** Edit batch (poin 1): ganti catatan &/atau ubah anggota (tambah/lepas order). */
  async editBatch(
    userId: string,
    id: string,
    dto: { note?: string; addOrderIds?: string[]; removeOrderIds?: string[] },
  ) {
    const [b] = await this.bypass(() => this.db.select().from(orderBatches)
      .where(and(eq(orderBatches.id, id), eq(orderBatches.userId, userId))).limit(1));
    if (!b) throw new NotFoundException("Batch tidak ditemukan");
    const rem = [...new Set((dto.removeOrderIds ?? []).filter(Boolean))];
    const add = [...new Set((dto.addOrderIds ?? []).filter(Boolean))];
    if (rem.length) await this.bypass(() => this.db.update(orders).set({ batchId: null, updatedAt: new Date() })
      .where(and(eq(orders.userId, userId), eq(orders.batchId, id), inArray(orders.id, rem))));
    if (add.length) await this.bypass(() => this.db.update(orders).set({ batchId: id, updatedAt: new Date() })
      .where(and(eq(orders.userId, userId), inArray(orders.id, add))));
    if (dto.note !== undefined) await this.bypass(() => this.db.update(orderBatches)
      .set({ note: dto.note!.slice(0, 255), updatedAt: new Date() })
      .where(and(eq(orderBatches.id, id), eq(orderBatches.userId, userId))));
    return this.getBatch(userId, id);
  }

  async batchPacking(
    userId: string,
    orderIds: string[],
    opts: { handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number }; takeouts?: { orderId: string; reason?: string }[]; skipRecord?: boolean },
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
    // Peta varian (sku_id) -> nama master produk AutoToko. Packing list memakai
    // nama katalog master; jika sku belum dipetakan, fallback ke gabungan nama
    // postingan + nama varian di bawah.
    const skuToMaster = new Map<string, string>();
    {
      const petaRows = await this.bypass(() => this.db
        .select({ sku: marketplaceSkuMap.sku, nama: masterProducts.name })
        .from(marketplaceSkuMap)
        .innerJoin(masterProducts, eq(marketplaceSkuMap.masterProductId, masterProducts.id))
        .where(and(eq(marketplaceSkuMap.userId, userId), eq(marketplaceSkuMap.marketplace, "tiktok"))));
      for (const r of petaRows) if (r.sku && r.nama) skuToMaster.set(String(r.sku), r.nama);
    }
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
          const ambilLabel = () => call(async (c) => c.get<{ doc_url?: string; tracking_number?: string }>(
            `/fulfillment/202309/packages/${pid}/shipping_documents`,
            await this.labelOpts(userId)));
          let doc: { doc_url?: string; tracking_number?: string } | null = null;
          try { doc = await ambilLabel(); } catch { doc = null; }
          if (!doc?.doc_url) {
            const body: Record<string, unknown> = {};
            if (opts.pickupSlot) {
              body.handover_method = "PICKUP";
              body.pickup_slot = { start_time: opts.pickupSlot.startTime, end_time: opts.pickupSlot.endTime };
            } else if (opts.handoverMethod) {
              body.handover_method = opts.handoverMethod;
            }
            await call((c) => c.post(`/fulfillment/202309/packages/${pid}/ship`, body));
            doc = await ambilLabel();
          }
          if (doc?.doc_url) {
            const res = await fetch(doc.doc_url);
            const bufLbl = Buffer.from(await res.arrayBuffer());
            labelBufs.push(bufLbl);
            // cache AWB batch: simpan label per order ke server (best-effort, byte sudah ada).
            try {
              const savedLbl = await this.uploads.saveFile(bufLbl, "pdf");
              await this.bypass(() => this.db.update(orders).set({ awbUrl: savedLbl.url }).where(and(eq(orders.userId, userId), eq(orders.id, oid))));
            } catch { /* best-effort */ }
          }
        }
        await this.bypass(() => this.db
          .update(orders)
          .set({ awbGenerated: true, holdReason: null, heldAt: null, fulfillmentStatus: majukanStatus(order.fulfillmentStatus as StatusInternal, "packing"), updatedAt: new Date() })
          .where(and(eq(orders.userId, userId), eq(orders.id, oid))));
        const rawItems = Array.isArray(order.items)
          ? (order.items as { name?: string; skuName?: string; sellerSku?: string; skuId?: string; qty?: number }[])
          : [];
        const seen = new Set<string>();
        for (const it of rawItems) {
          const master = it.skuId ? skuToMaster.get(String(it.skuId)) : undefined;
          const nm = master
            || ([it.name, it.skuName].filter(Boolean).join(" \u00b7 ") || it.sellerSku || "-");
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

    // Persist batch (poin 1): order yang BERHASIL diproses dikelompokkan jadi satu
    // batch yang tampil di halaman order & bisa diedit. Best-effort — kegagalan
    // pencatatan tak menggagalkan hasil RTS yang sudah terjadi.
    let batchId: string | null = null;
    const okIds = hasil.filter((h) => h.ok).map((h) => h.orderId);
    if (okIds.length && !opts.skipRecord) {
      try {
        const catatan = `Batch ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })}`;
        const [b] = await this.bypass(() => this.db.insert(orderBatches)
          .values({ userId, note: catatan, handoverMethod: opts.handoverMethod ?? null, status: "processed" })
          .returning({ id: orderBatches.id }));
        batchId = b?.id ?? null;
        if (batchId) await this.bypass(() => this.db.update(orders)
          .set({ batchId, updatedAt: new Date() })
          .where(and(eq(orders.userId, userId), inArray(orders.id, okIds))));
      } catch (e) { this.logger.warn(`Catat batch gagal: ${(e as Error).message}`); }
    }
    return { total: ids.length, ok: hasil.filter((h) => h.ok).length, ditahan: takeouts.length, batchId, labelsPdf, packingListPdf, hasil };
  }

  /**
   * Mulai batch packing ASINKRON: buat batch (status "processing") + kembalikan id
   * cepat, lalu proses RTS+label+PDF di background (uploads ke URL). APK/web tinggal
   * poll getBatchPacking lalu unduh resi & packing list. Menghindari request panjang
   * yang bikin koneksi (APK) putus.
   */
  async batchPackingStart(
    userId: string,
    orderIds: string[],
    opts: { handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number }; takeouts?: { orderId: string; reason?: string }[] },
  ) {
    const ids = [...new Set((orderIds ?? []).filter(Boolean))];
    if (!ids.length) throw new BadRequestException("Tidak ada order dipilih");
    const catatan = `Batch ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })}`;
    const [b] = await this.bypass(() => this.db.insert(orderBatches)
      .values({ userId, note: catatan, handoverMethod: opts.handoverMethod ?? null, status: "processing" })
      .returning({ id: orderBatches.id }));
    const batchId = b!.id;
    await this.bypass(() => this.db.update(orders).set({ batchId, updatedAt: new Date() })
      .where(and(eq(orders.userId, userId), inArray(orders.id, ids))));
    setImmediate(() => { void this.batchPackingBackground(userId, batchId, ids, opts); });
    return { batchId, status: "processing" as const, total: ids.length };
  }

  private async batchPackingBackground(
    userId: string,
    batchId: string,
    ids: string[],
    opts: { handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number }; takeouts?: { orderId: string; reason?: string }[] },
  ) {
    try {
      const r = await this.batchPacking(userId, ids, { ...opts, skipRecord: true });
      let resiUrl: string | null = null;
      let packUrl: string | null = null;
      if (r.labelsPdf) { try { resiUrl = (await this.uploads.saveFile(Buffer.from(r.labelsPdf, "base64"), "pdf")).url; } catch { /* best-effort */ } }
      if (r.packingListPdf) { try { packUrl = (await this.uploads.saveFile(Buffer.from(r.packingListPdf, "base64"), "pdf")).url; } catch { /* best-effort */ } }
      await this.bypass(() => this.db.update(orderBatches).set({
        status: "done", resiPdfUrl: resiUrl, packingListPdfUrl: packUrl,
        result: { total: r.total, ok: r.ok, ditahan: r.ditahan, hasil: r.hasil }, updatedAt: new Date(),
      }).where(and(eq(orderBatches.id, batchId), eq(orderBatches.userId, userId))));
    } catch (e) {
      this.logger.warn(`Batch packing ${batchId}: ${(e as Error).message}`);
      await this.bypass(() => this.db.update(orderBatches).set({ status: "error", errorMessage: (e as Error).message, updatedAt: new Date() })
        .where(and(eq(orderBatches.id, batchId), eq(orderBatches.userId, userId)))).catch(() => {});
    }
  }

  /** Status + hasil batch packing (utk polling APK/web). */
  async getBatchPacking(userId: string, batchId: string) {
    const [b] = await this.bypass(() => this.db.select().from(orderBatches)
      .where(and(eq(orderBatches.id, batchId), eq(orderBatches.userId, userId))).limit(1));
    if (!b) throw new NotFoundException("Batch tidak ditemukan");
    return {
      id: b.id, status: b.status, note: b.note, createdAt: b.createdAt,
      resiPdfUrl: b.resiPdfUrl ?? null, packingListPdfUrl: b.packingListPdfUrl ?? null,
      result: b.result ?? null, errorMessage: b.errorMessage ?? null,
    };
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
            doc = await klien.get(`/fulfillment/202309/packages/${pid}/shipping_documents`, await this.labelOpts(userId));
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
    // Poin 5: unduh PDF label & SIMPAN ke server kita (audit/cetak-ulang/offline);
    // catat awb_url di order supaya tak bergantung URL marketplace yang bisa
    // kedaluwarsa. Best-effort — kegagalan cache tak menggagalkan pengambilan.
    let awbUrl: string | null = null;
    const pertama = hasil.find((h) => h.docUrl);
    if (pertama?.docUrl) {
      try {
        const res = await fetch(pertama.docUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        const saved = await this.uploads.saveFile(buf, "pdf");
        awbUrl = saved.url;
        await this.bypass(() => this.db.update(orders)
          .set({ awbUrl, updatedAt: new Date() })
          .where(and(eq(orders.userId, userId), eq(orders.id, orderId))));
      } catch (e) { this.logger.warn(`Cache AWB ${orderId}: ${(e as Error).message}`); }
    }
    return { orderId, awbUrl, hasil };
  }

  /**
   * RTS / arrange shipment ke marketplace. TULIS & OUTWARD: memindahkan paket
   * ke "menunggu kurir" (AWAITING_COLLECTION) di seller center, memicu AWB &
   * bisa memicu penjemputan. Hanya dipanggil manual dari UI dengan konfirmasi.
   * Setelah semua paket sukses, status lokal dimajukan ke "packing" (menunggu dipacking).
   */
  /**
   * Unduh & SIMPAN label/AWB ke server (orders.awb_url) TANPA mengubah status.
   * Dipakai setelah RTS supaya tombol Cetak Resi menunjuk file di server, bukan
   * memanggil marketplace tiap kali. Best-effort; lewati jika sudah ter-cache.
   */
  /**
   * Audit Pesanan sumber API: tarik penyelesaian (settlement) per pesanan dari
   * TikTok Finance API (Get Statements -> Get Statement Transactions) dan tulis
   * sebagai baris statement `source='api'` -- bentuknya sama dengan hasil unggah
   * laporan, jadi rekonsiliasi audit tidak berubah. Idempoten: tarik-ulang
   * periode yang sama membuang baris API lamanya lebih dulu. READ-only ke
   * marketplace; tidak pernah menulis ke TikTok.
   */
  async tarikPencairanApi(
    userId: string,
    q: { shopId?: string | null; from: string; to: string },
  ): Promise<{ toko: number; statement: number; pesanan: number }> {
    if (!q.from || !q.to) throw new BadRequestException("Rentang tanggal wajib diisi");
    const tokoList = q.shopId
      ? await this.bypass(() => this.db.select().from(shops)
          .where(and(eq(shops.id, q.shopId!), eq(shops.userId, userId))).limit(1))
      : await this.tokoSiap(userId);
    if (!tokoList.length) throw new NotFoundException("Toko tidak ditemukan / belum tersambung API");

    const fromUnix = Math.floor(new Date(q.from + "T00:00:00Z").getTime() / 1000);
    const toUnix = Math.floor(new Date(q.to + "T23:59:59Z").getTime() / 1000);
    const tglDari = (unix: unknown): string => {
      const n = Number(unix);
      if (!Number.isFinite(n) || n <= 0) return q.to;
      return new Date(n * 1000).toISOString().slice(0, 10);
    };
    const angka = (v: unknown): number => {
      const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };

    let totalPesanan = 0, statementRows = 0;
    for (const toko of tokoList) {
      if (toko.marketplace !== "tiktok" || !toko.accessToken || !toko.shopCipher) continue;
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

      // Satu baris statement sintetis per (toko, periode) sumber API, dipakai
      // ulang saat ditarik ulang agar tidak menumpuk.
      const hash = `api:${toko.id}:${q.from}:${q.to}`;
      const [ada] = await this.bypass(() => this.db.select({ id: marketplaceStatements.id })
        .from(marketplaceStatements)
        .where(and(eq(marketplaceStatements.userId, userId), eq(marketplaceStatements.fileHash, hash)))
        .limit(1));
      let statementId = ada?.id;
      if (statementId) {
        await this.bypass(() => this.db.delete(marketplaceStatementLines)
          .where(eq(marketplaceStatementLines.statementId, statementId!)));
      } else {
        const [ins] = await this.bypass(() => this.db.insert(marketplaceStatements).values({
          userId, shopId: toko.id, marketplace: "tiktok", source: "api",
          periodFrom: q.from, periodTo: q.to, currency: null,
          fileName: `API TikTok ${q.from}..${q.to}`, fileHash: hash,
        }).returning({ id: marketplaceStatements.id }));
        statementId = ins?.id;
      }
      if (!statementId) continue;
      statementRows += 1;

      const lines: {
        statementId: string; userId: string; kind: string; externalRef: string | null;
        occurredOn: string; amount: string; status: string | null; raw: unknown;
      }[] = [];
      let stPage: string | null = null, guardS = 0;
      do {
        const hs = await call((c) => c.daftarStatement({ statementTimeGe: fromUnix, statementTimeLt: toUnix, pageToken: stPage }));
        for (const st of hs.data) {
          const sid = String((st as Record<string, unknown>).id ?? (st as Record<string, unknown>).statement_id ?? "");
          if (!sid) continue;
          const cairOn = tglDari((st as Record<string, unknown>).statement_time);
          const status = String((st as Record<string, unknown>).payment_status ?? (st as Record<string, unknown>).status ?? "SETTLED");
          let txPage: string | null = null, guardT = 0;
          do {
            const ht = await call((c) => c.transaksiStatement(sid, { pageToken: txPage }));
            for (const tx of ht.data) {
              const t = tx as Record<string, unknown>;
              const orderId = String(t.order_id ?? "").trim();
              if (!orderId) continue;
              lines.push({
                statementId: statementId!, userId, kind: "order",
                externalRef: orderId, occurredOn: cairOn,
                amount: angka(t.settlement_amount).toString(), status, raw: tx,
              });
            }
            txPage = ht.nextPageToken;
          } while (txPage && ++guardT < 500);
        }
        stPage = hs.nextPageToken;
      } while (stPage && ++guardS < 500);

      for (let i = 0; i < lines.length; i += 200) {
        const chunk = lines.slice(i, i + 200);
        if (chunk.length) await this.bypass(() => this.db.insert(marketplaceStatementLines).values(chunk));
      }
      totalPesanan += lines.length;

      const total = lines.reduce((acc, l) => acc + Number(l.amount), 0);
      await this.bypass(() => this.db.update(marketplaceStatements)
        .set({ settlementAmount: total.toString(), importedAt: new Date(), updatedAt: new Date() })
        .where(eq(marketplaceStatements.id, statementId!)));
    }

    return { toko: tokoList.length, statement: statementRows, pesanan: totalPesanan };
  }

  /**
   * "Sudah dicairkan TikTok tapi belum ditarik" per toko, DIAMBIL dari Get
   * Statements (bukan hitungan kami): tiap statement membawa settlement_amount +
   * payment_status. Statement yang statusnya BUKAN paid (mis. PENDING/PROCESSING)
   * = sudah di-settle TikTok tapi belum cair ke rekening. Rincian per status ikut
   * dikembalikan supaya bisa dicocokkan langsung ke Seller Center. READ-only.
   */
  /**
   * DIAGNOSTIK saldo: net mutasi wallet (Get Withdrawals) all-history. Balance =
   * jumlah SEMUA amount ber-tanda (income - penarikan). Mengembalikan ringkasan
   * per-type ber-tanda + contoh mentah agar formula final bisa dikunci ke angka
   * Seller Center. READ-only.
   */
  /**
   * Saldo bisa ditarik per toko dari TikTok Finance (Get Withdrawals, all-history):
   * penghasilan (SETTLE) - penarikan (WITHDRAW), HANYA status SUCCESS (WITHDRAW
   * FAILED tidak mengurangi saldo). Terverifikasi cocok dengan Seller Center pada
   * toko tanpa fitur transfer (mis. Reysowner = 46.123). Toko yang memakai fitur
   * "transfer saldo" (mis. ke Saldo Iklan) ditandai adaTransfer -- angkanya bisa
   * lebih tinggi dari saldo asli karena TikTok tak memberi arah transfer di API.
   * READ-only.
   */
  /**
   * Saldo bisa ditarik per toko dari TikTok Finance (Get Withdrawals):
   *  - Toko TANPA Saldo Cepat: Σ SETTLE(SUCCESS) − Σ WITHDRAW(SUCCESS) all-history.
   *    Terverifikasi cocok Seller Center (Reysowner = 46.123).
   *  - Toko yang PERNAH pakai Saldo Cepat: gerakan advance/pelunasan dilebur jadi
   *    TRANSFER tak berarah di API sehingga all-history tak bisa. SOLUSI: seller
   *    mematikan Saldo Cepat lalu input saldo saat ini (cutoff) + tanggal; saldo =
   *    cutoff + (SETTLE − WITHDRAW) SEJAK cutoff (setelah itu mutasi normal).
   *  - Toko ber-TRANSFER TAPI belum set cutoff: saldo=null, perluCutoff=true.
   * READ-only.
   */
  /**
   * Saldo bisa ditarik per toko. Default membaca CACHE (kolom shops.saldo_last)
   * supaya kartu langsung tampil tanpa panggil API. `live=true` menghitung ulang
   * dari TikTok Finance lalu memperbarui cache. Rumus per toko: toko normal =
   * Σ SETTLE(SUCCESS) − Σ WITHDRAW(SUCCESS) all-history; toko ber-cutoff Saldo
   * Cepat = cutoff + (SETTLE − WITHDRAW) sejak tanggal cutoff. WITHDRAW yang
   * masih PROCESSING ikut dikurangi (dana sudah keluar); FAILED tidak.
   */
  async saldoTiktok(userId: string, shopId?: string | null, live = false) {
    const tokoList = shopId
      ? await this.bypass(() => this.db.select().from(shops)
          .where(and(eq(shops.id, shopId), eq(shops.userId, userId))).limit(1))
      : await this.bypass(() => this.db.select().from(shops)
          .where(and(eq(shops.userId, userId), eq(shops.marketplace, "tiktok"))));

    const tsIso = (d: unknown): string | null => {
      if (!d) return null;
      const x = d instanceof Date ? d : new Date(String(d));
      return Number.isNaN(x.getTime()) ? null : x.toISOString();
    };

    // ---- CACHED (default): baca shops.saldo_last, tanpa API ----
    if (!live) {
      const toko = tokoList
        .filter((t) => t.marketplace === "tiktok" && t.accessToken && t.shopCipher)
        .map((t) => {
          const cached = t.saldoLast as Record<string, unknown> | null;
          if (cached && typeof cached === "object") return { ...cached, diperbaruiPada: tsIso(t.saldoLastAt) };
          return { shopId: t.id, shopName: t.displayName || t.shopName, currency: "IDR", saldo: null, belumDicek: true };
        });
      const total = toko.reduce((a, x) => {
        const v = (x as Record<string, unknown>).saldo;
        return a + (typeof v === "number" ? v : 0);
      }, 0);
      const times = tokoList.map((t) => (t.saldoLastAt ? new Date(t.saldoLastAt as unknown as string).getTime() : 0)).filter(Boolean);
      const diperbaruiPada = times.length ? new Date(Math.max(...times)).toISOString() : null;
      return { toko, total, diperbaruiPada, cached: true };
    }

    // ---- LIVE: hitung dari API + simpan ke cache ----
    const angka = (v: unknown): number => {
      const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const nowSec = Math.floor(Date.now() / 1000) + 86400;

    const toko: Array<Record<string, unknown>> = [];
    for (const t of tokoList) {
      if (t.marketplace !== "tiktok" || !t.accessToken || !t.shopCipher) continue;
      let klien = await this.klien(t);
      let segar = false;
      const call = async <T>(fn: (c: TikTokClient) => Promise<T>): Promise<T> => {
        for (;;) {
          try { return await fn(klien); }
          catch (e) {
            if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(t); continue; }
            throw e;
          }
        }
      };
      const punyaCutoff = t.saldoCutoffDate != null && t.saldoCutoffAmount != null;
      const geSec = punyaCutoff
        ? Math.floor(new Date(String(t.saldoCutoffDate) + "T00:00:00Z").getTime() / 1000) + 86400
        : 1577836800;
      let settle = 0, withdraw = 0, withdrawProc = 0, transfer = 0, n = 0;
      let currency: string | null = null;
      let obj: Record<string, unknown>;
      try {
        const akum = async (geS: number, ltS: number, incProc: boolean) => {
          let s = 0, w = 0, wp = 0, tr = 0, cnt = 0;
          let cur: string | null = null;
          let page: string | null = null, guard = 0;
          do {
            const h = await call((c) => c.daftarWithdrawal({ createTimeGe: geS, createTimeLt: ltS, pageToken: page }));
            for (const row of h.data) {
              const rec = row as Record<string, unknown>;
              const st = String(rec.status ?? "").toUpperCase();
              if (st === "FAILED") continue; // gagal/REVERSE: dana kembali
              const tipe = String(rec.type ?? "").toUpperCase();
              const amt = angka(rec.amount);
              if (!cur && rec.currency) cur = String(rec.currency);
              if (tipe === "SETTLE") { if (st === "SUCCESS") { s += amt; cnt += 1; } }
              else if (tipe === "WITHDRAW") {
                if (st === "SUCCESS") { w += amt; cnt += 1; }
                else if (incProc && st === "PROCESSING") { wp += amt; cnt += 1; }
              } else if (tipe === "TRANSFER") { if (st === "SUCCESS") { tr += amt; cnt += 1; } }
            }
            page = h.nextPageToken;
          } while (page && ++guard < 500);
          return { s, w, wp, tr, cnt, cur };
        };
        // Incremental (watermark): totals "beku" (status final) utk create_time
        // < upTo disimpan di shops.saldo_frozen; tiap klik cukup hitung ulang
        // window volatil 60 hari terakhir (tangkap PROCESSING->SUCCESS/FAILED).
        // Klik pertama membangun beku sekali (all-history), berikutnya cepat.
        const TRAILING = 60 * 86400;
        const freezeBoundary = Math.floor(Date.now() / 1000) - TRAILING;
        type Frozen = { base: number; upTo: number; settle: number; withdraw: number; transfer: number; n: number };
        const rawFrozen = t.saldoFrozen as Frozen | null;
        let frozen: Frozen =
          rawFrozen && rawFrozen.base === geSec && rawFrozen.upTo >= geSec
            ? rawFrozen
            : { base: geSec, upTo: geSec, settle: 0, withdraw: 0, transfer: 0, n: 0 };
        if (freezeBoundary > frozen.upTo) {
          const f = await akum(frozen.upTo, freezeBoundary, false);
          frozen = {
            base: geSec, upTo: freezeBoundary,
            settle: frozen.settle + f.s, withdraw: frozen.withdraw + f.w,
            transfer: frozen.transfer + f.tr, n: frozen.n + f.cnt,
          };
          if (f.cur && !currency) currency = f.cur;
          await this.bypass(() => this.db.update(shops)
            .set({ saldoFrozen: frozen as unknown as Record<string, unknown> })
            .where(and(eq(shops.id, t.id), eq(shops.userId, userId)))).catch(() => {});
        }
        const vol = await akum(frozen.upTo, nowSec, true);
        settle = frozen.settle + vol.s;
        withdraw = frozen.withdraw + vol.w;
        withdrawProc = vol.wp;
        transfer = frozen.transfer + vol.tr;
        n = frozen.n + vol.cnt;
        if (!currency) currency = vol.cur;

        if (punyaCutoff) {
          const cutoffAmt = Number(t.saldoCutoffAmount) || 0;
          obj = {
            shopId: t.id, shopName: t.displayName || t.shopName, currency: currency ?? "IDR",
            saldo: Math.round(cutoffAmt + settle - withdraw - withdrawProc),
            cutoff: { tanggal: t.saldoCutoffDate, saldo: Math.round(cutoffAmt) },
            deltaSejakCutoff: Math.round(settle - withdraw - withdrawProc),
            penghasilan: Math.round(settle), penarikan: Math.round(withdraw),
            penarikanDiproses: Math.round(withdrawProc),
            transferSejakCutoff: Math.round(transfer), adaTransfer: false, mutasi: n,
          };
        } else {
          const adaTransfer = transfer > 0;
          obj = {
            shopId: t.id, shopName: t.displayName || t.shopName, currency: currency ?? "IDR",
            saldo: adaTransfer ? null : Math.round(settle - withdraw - withdrawProc),
            penghasilan: Math.round(settle), penarikan: Math.round(withdraw),
            penarikanDiproses: Math.round(withdrawProc),
            transfer: Math.round(transfer), adaTransfer, perluCutoff: adaTransfer, mutasi: n,
          };
        }
      } catch (e) {
        obj = { shopId: t.id, shopName: t.displayName || t.shopName, currency: null, saldo: null, error: (e as Error).message };
      }
      // simpan ke cache (best-effort)
      await this.bypass(() => this.db.update(shops)
        .set({ saldoLast: obj, saldoLastAt: new Date() })
        .where(and(eq(shops.id, t.id), eq(shops.userId, userId)))).catch(() => {});
      toko.push({ ...obj, diperbaruiPada: new Date().toISOString() });
    }
    const total = toko.reduce((a, x) => a + (typeof x.saldo === "number" ? x.saldo : 0), 0);
    return { toko, total, diperbaruiPada: new Date().toISOString(), cached: false };
  }

  /**
   * Refresh data TikTok untuk SATU order (on-demand): GetPriceDetail + GetTracking,
   * disimpan ke orders.price_detail / orders.tracking_last. Dipakai tombol refresh
   * per order & saat buka detail order.
   */
  async refreshOrderTiktok(userId: string, orderId: string) {
    const [o] = await this.bypass(() => this.db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1));
    if (!o) throw new NotFoundException("Order tidak ditemukan");
    if (o.marketplace !== "tiktok") throw new BadRequestException("Order ini bukan dari TikTok");
    const [t] = await this.bypass(() => this.db.select().from(shops)
      .where(and(eq(shops.id, o.shopId as string), eq(shops.userId, userId))).limit(1));
    if (!t || !t.accessToken || !t.shopCipher) throw new BadRequestException("Toko TikTok belum tersambung API");
    let klien = await this.klien(t);
    let segar = false;
    const call = async <T>(fn: (c: TikTokClient) => Promise<T>): Promise<T> => {
      for (;;) {
        try { return await fn(klien); }
        catch (e) {
          if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(t); continue; }
          throw e;
        }
      }
    };
    const oid = o.marketplaceOrderId as string;
    let priceDetail: unknown = o.priceDetail ?? null;
    let tracking: unknown = o.trackingLast ?? null;
    try { priceDetail = await call((c) => c.priceDetail(oid)); }
    catch (e) { this.logger.warn(`priceDetail ${oid}: ${(e as Error).message}`); }
    try {
      const tr = await call((c) => c.orderTracking(oid));
      tracking = (tr as { tracking?: unknown })?.tracking ?? tr;
    } catch (e) { this.logger.warn(`tracking ${oid}: ${(e as Error).message}`); }
    await this.bypass(() => this.db.update(orders)
      .set({ priceDetail: priceDetail as Record<string, unknown> | null, trackingLast: tracking as Record<string, unknown> | null, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId))));
    return { ok: true, priceDetail, tracking };
  }

  /** Set/hapus cutoff Saldo Cepat sebuah toko (tanggal null = hapus cutoff). */
  async setSaldoCutoff(userId: string, shopId: string, tanggal: string | null, saldo: number | null) {
    const [shop] = await this.bypass(() => this.db.select({ id: shops.id })
      .from(shops).where(and(eq(shops.id, shopId), eq(shops.userId, userId))).limit(1));
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    const clear = !tanggal || saldo == null;
    await this.bypass(() => this.db.update(shops).set({
      saldoCutoffDate: clear ? null : tanggal,
      saldoCutoffAmount: clear ? null : String(saldo),
    }).where(and(eq(shops.id, shopId), eq(shops.userId, userId))));
    return { ok: true, shopId, tanggal: clear ? null : tanggal, saldo: clear ? null : saldo };
  }

  /**
   * Daftar penarikan (WITHDRAW) sebuah toko TikTok dalam rentang tanggal — untuk
   * import & verifikasi Pencairan Dana. Hanya type WITHDRAW (uang keluar ke bank).
   * Default status SUCCESS; includeProcessing menambah yang masih diproses.
   */
  async daftarPenarikanToko(
    userId: string,
    shopId: string,
    opts: { from: string; to: string; includeProcessing?: boolean },
  ): Promise<Array<{ externalRef: string; amount: number; tanggal: string; status: string; currency: string }>> {
    const [t] = await this.bypass(() => this.db.select().from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId))).limit(1));
    if (!t) throw new NotFoundException("Toko tidak ditemukan");
    if (t.marketplace !== "tiktok" || !t.accessToken || !t.shopCipher)
      throw new BadRequestException("Toko bukan TikTok atau belum tersambung API");
    const geSec = Math.floor(new Date(opts.from + "T00:00:00Z").getTime() / 1000);
    const ltSec = Math.floor(new Date(opts.to + "T00:00:00Z").getTime() / 1000) + 86400;
    const angka = (v: unknown): number => {
      const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    let klien = await this.klien(t);
    let segar = false;
    const call = async <T>(fn: (c: TikTokClient) => Promise<T>): Promise<T> => {
      for (;;) {
        try { return await fn(klien); }
        catch (e) {
          if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(t); continue; }
          throw e;
        }
      }
    };
    const out: Array<{ externalRef: string; amount: number; tanggal: string; status: string; currency: string }> = [];
    let page: string | null = null, guard = 0;
    do {
      const h = await call((c) => c.daftarWithdrawal({ createTimeGe: geSec, createTimeLt: ltSec, pageToken: page }));
      for (const w of h.data) {
        const rec = w as Record<string, unknown>;
        if (String(rec.type ?? "").toUpperCase() !== "WITHDRAW") continue;
        const st = String(rec.status ?? "").toUpperCase();
        if (st !== "SUCCESS" && !(opts.includeProcessing && st === "PROCESSING")) continue;
        const ctSec = Number(rec.create_time ?? 0);
        const tanggal = ctSec ? new Date(ctSec * 1000).toISOString().slice(0, 10) : opts.from;
        out.push({
          externalRef: String(rec.id ?? rec.withdraw_id ?? `${ctSec}_${angka(rec.amount)}`),
          amount: angka(rec.amount),
          tanggal, status: st, currency: String(rec.currency ?? "IDR"),
        });
      }
      page = h.nextPageToken;
    } while (page && ++guard < 500);
    return out;
  }

  /** Tipe & ukuran dokumen resi dari pengaturan order; default packing slip (daftar produk) + A6. */
  private async labelOpts(userId: string): Promise<{ document_type: string; document_size: string }> {
    const [row] = await this.bypass(() => this.db
      .select({ t: orderSettings.docType, s: orderSettings.docSize })
      .from(orderSettings).where(eq(orderSettings.userId, userId)).limit(1));
    return {
      document_type: row?.t || "SHIPPING_LABEL_AND_PACKING_SLIP",
      document_size: row?.s || "A6",
    };
  }

  private async cacheAwb(userId: string, orderId: string): Promise<string | null> {
    const [o] = await this.bypass(() => this.db
      .select({ awbUrl: orders.awbUrl, raw: orders.raw, shopId: orders.shopId })
      .from(orders).where(and(eq(orders.userId, userId), eq(orders.id, orderId))).limit(1));
    if (!o) return null;
    if (o.awbUrl) return o.awbUrl;
    const ids = this.packageIds(o.raw);
    if (!ids.length) return null;
    const [toko] = await this.bypass(() => this.db.select().from(shops).where(eq(shops.id, o.shopId)).limit(1));
    if (!toko || !toko.accessToken || !toko.shopCipher) return null;
    let klien = await this.klien(toko);
    let segar = false;
    for (const pid of ids) {
      try {
        let doc: { doc_url?: string } | undefined;
        for (;;) {
          try {
            doc = await klien.get(`/fulfillment/202309/packages/${pid}/shipping_documents`, await this.labelOpts(userId));
            break;
          } catch (e) {
            if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(toko); continue; }
            throw e;
          }
        }
        if (doc?.doc_url) {
          const res = await fetch(doc.doc_url);
          const buf = Buffer.from(await res.arrayBuffer());
          const saved = await this.uploads.saveFile(buf, "pdf");
          await this.bypass(() => this.db.update(orders).set({ awbUrl: saved.url, updatedAt: new Date() })
            .where(and(eq(orders.userId, userId), eq(orders.id, orderId))));
          return saved.url;
        }
      } catch (e) { this.logger.warn(`cacheAwb ${orderId} pkg ${pid}: ${(e as Error).message}`); }
    }
    return null;
  }

  /**
   * Slot jadwal jemput (pickup) untuk order sameday/instant. Diambil dari paket
   * pertama order (umumnya satu paket). READ-only ke marketplace.
   */
  async slotJemputOrder(userId: string, orderId: string) {
    const { order, toko } = await this.ambilOrderToko(userId, orderId);
    const ids = this.packageIds(order.raw);
    if (!ids.length) throw new BadRequestException("Order belum punya paket di marketplace");
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
    const pid = ids[0]!;
    const d = await call((c) => c.slotJemput(pid));
    const slots = (d.pickup_slots ?? [])
      .filter((sl) => sl.start_time && sl.end_time)
      .map((sl) => ({ startTime: Number(sl.start_time), endTime: Number(sl.end_time), tersedia: sl.avaliable !== false }));
    return {
      orderId,
      packageId: pid,
      bisaJemput: d.can_pickup !== false,
      bisaDropOff: !!d.can_drop_off,
      dropOffUrl: d.drop_off_point_url ?? null,
      slots,
    };
  }

  async shipOrder(userId: string, orderId: string, opts: { handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number } }) {
    const { order, toko } = await this.ambilOrderToko(userId, orderId);
    const ids = this.packageIds(order.raw);
    if (!ids.length) throw new BadRequestException("Order belum punya paket di marketplace");
    let klien = await this.klien(toko);
    let sudahSegar = false;
    const hasil: { packageId: string; ok: boolean; error?: string }[] = [];
    for (const pid of ids) {
      const body: Record<string, unknown> = {};
      if (opts.pickupSlot) {
        body.handover_method = "PICKUP";
        body.pickup_slot = { start_time: opts.pickupSlot.startTime, end_time: opts.pickupSlot.endTime };
      } else if (opts.handoverMethod) {
        body.handover_method = opts.handoverMethod;
      }
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
          fulfillmentStatus: majukanStatus(order.fulfillmentStatus as StatusInternal, "approved"),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.userId, userId), eq(orders.id, orderId))));
      // Status baru AWAITING_COLLECTION -> simpan AWB ke server (best-effort).
      await this.cacheAwb(userId, orderId).catch(() => {});
    }
    return { orderId, ok: semuaOk, hasil };
  }

  // ---------------------------------------------------------- Promotion
  async promoListActivities(userId: string, opts: { status?: string; type?: string; title?: string; pageSize?: number } = {}) {
    const toko = await this.tokoSiap(userId);
    const out: Array<Record<string, unknown>> = [];
    for (const t of toko) {
      if (t.marketplace !== "tiktok") continue;
      try {
        const resp = await this.panggilTikTok(t, (c) => c.promoSearchActivities({
          page_size: opts.pageSize ?? 50,
          ...(opts.status ? { status: opts.status } : {}),
          ...(opts.type ? { activity_type: opts.type } : {}),
          ...(opts.title ? { activity_title: opts.title } : {}),
        }));
        const acts = ((resp as any)?.activities ?? (resp as any)?.activity_list ?? []) as unknown[];
        out.push({ shopId: t.id, shopName: t.shopName ?? t.id, activities: acts });
      } catch (e) { out.push({ shopId: t.id, shopName: t.shopName ?? t.id, activities: [], error: (e as Error).message }); }
    }
    return out;
  }
  async promoActivityDetail(userId: string, shopId: string, activityId: string) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoGetActivity(activityId));
  }
  async promoAddProducts(userId: string, shopId: string, activityId: string, products: Array<Record<string, unknown>>) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoUpdateProducts(activityId, products));
  }
  async promoRemoveProducts(userId: string, shopId: string, activityId: string, productIds: string[]) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoRemoveProducts(activityId, productIds));
  }
  async promoDeactivate(userId: string, shopId: string, activityId: string) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoDeactivateActivity(activityId));
  }
  async promoCreate(userId: string, shopId: string, body: Record<string, unknown>) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoCreateActivity(body));
  }

  /**
   * Replikasi sebuah promo (activity) yang sukses ke toko lain: buat activity
   * baru dgn konfigurasi sama (tipe/judul/durasi/waktu) di tiap toko target,
   * lalu daftarkan produk aktif toko itu dgn diskon yang diminta. Aksi outward
   * (mengubah harga) — dipicu klik seller. Waktu digeser ke masa depan bila
   * waktu sumber sudah lewat (TikTok menolak begin_time di masa lalu).
   */
  async replicatePromo(
    userId: string,
    sourceShopId: string,
    sourceActivityId: string,
    targetShopIds: string[],
    discountPct: number,
  ) {
    const src = (await this.promoActivityDetail(userId, sourceShopId, sourceActivityId)) as Record<string, unknown>;
    const type = String(src.activity_type ?? "DIRECT_DISCOUNT");
    const durationType = String(src.duration_type ?? "NORMAL");
    const title = (`${String(src.title ?? "Promo")} (Replikasi)`).slice(0, 50);
    const disc = String(Number(discountPct) || 10);
    const now = Math.floor(Date.now() / 1000);
    const results: Array<Record<string, unknown>> = [];
    for (const shopId of targetShopIds) {
      try {
        const t = await this.tokoTikTok(userId, shopId);
        const body: Record<string, unknown> = { activity_type: type, title, product_level: "PRODUCT", duration_type: durationType };
        if (durationType === "NORMAL") {
          let b = Number(src.begin_time) || 0;
          let e = Number(src.end_time) || 0;
          const dur = e > b ? e - b : 7 * 86400;
          if (b <= now + 300) { b = now + 3600; e = b + dur; }
          body.begin_time = b;
          body.end_time = e;
        }
        const created = (await this.panggilTikTok(t, (c) => c.promoCreateActivity(body))) as Record<string, unknown>;
        const newId = String(created?.activity_id ?? created?.id ?? "");
        let added = 0;
        if (newId) {
          const resp = await this.panggilTikTok(t, (c) => c.cariProduk({ pageSize: 50 }));
          const products = (resp?.data ?? [])
            .map((p) => ({ id: String((p as Record<string, unknown>).id ?? ""), discount: disc }))
            .filter((p) => p.id);
          if (products.length) {
            await this.panggilTikTok(t, (c) => c.promoUpdateProducts(newId, products));
            added = products.length;
          }
        }
        results.push({ shopId, shopName: t.shopName ?? shopId, activityId: newId, added });
      } catch (e) {
        results.push({ shopId, error: (e as Error).message });
      }
    }
    return { source: { shopId: sourceShopId, activityId: sourceActivityId }, discountPct: Number(disc), results };
  }
  async promoUpdate(userId: string, shopId: string, activityId: string, body: Record<string, unknown>) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoUpdateActivity(activityId, body));
  }
  async promoListCoupons(userId: string, opts: { status?: string; pageSize?: number } = {}) {
    const toko = await this.tokoSiap(userId);
    const out: Array<Record<string, unknown>> = [];
    for (const t of toko) {
      if (t.marketplace !== "tiktok") continue;
      try {
        const resp = await this.panggilTikTok(t, (c) => c.promoSearchCoupons({
          page_size: opts.pageSize ?? 50, ...(opts.status ? { status: opts.status } : {}),
        }));
        out.push({ shopId: t.id, shopName: t.shopName ?? t.id, coupons: ((resp as any)?.coupons ?? (resp as any)?.coupon_list ?? []) });
      } catch (e) { out.push({ shopId: t.id, shopName: t.shopName ?? t.id, coupons: [], error: (e as Error).message }); }
    }
    return out;
  }
  async promoCouponDetail(userId: string, shopId: string, couponId: string) {
    const t = await this.tokoTikTok(userId, shopId);
    return this.panggilTikTok(t, (c) => c.promoGetCoupon(couponId));
  }
  async getPromoSettings(userId: string) {
    return this.bypass(() => this.db.select().from(promotionSettings).where(eq(promotionSettings.userId, userId)));
  }
  async setPromoSettings(userId: string, shopId: string, dto: { autoJoin?: boolean; activityId?: string | null; discountPct?: number }) {
    await this.tokoTikTok(userId, shopId);
    const vals = {
      userId, shopId, autoJoin: !!dto.autoJoin,
      activityId: dto.activityId || null,
      discountPct: String(dto.discountPct ?? 10),
      updatedAt: new Date(),
    };
    await this.bypass(() => this.db.insert(promotionSettings).values(vals).onConflictDoUpdate({
      target: [promotionSettings.userId, promotionSettings.shopId],
      set: { autoJoin: vals.autoJoin, activityId: vals.activityId, discountPct: vals.discountPct, updatedAt: new Date() },
    }));
    return vals;
  }
  /** Auto-ikut: daftarkan produk aktif toko (halaman pertama) ke activity target dgn diskon default. */
  async applyAutoJoin(userId: string, shopId: string) {
    const [ps] = await this.bypass(() => this.db.select().from(promotionSettings)
      .where(and(eq(promotionSettings.userId, userId), eq(promotionSettings.shopId, shopId))).limit(1));
    if (!ps || !ps.activityId) throw new BadRequestException("Pilih activity target dulu di pengaturan Auto-ikut");
    const t = await this.tokoTikTok(userId, shopId);
    const disc = String(Number(ps.discountPct) || 10);
    const resp = await this.panggilTikTok(t, (c) => c.cariProduk({ pageSize: 50 }));
    const products = (resp?.data ?? [])
      .map((p) => ({ id: String((p as Record<string, unknown>).id ?? ""), discount: disc }))
      .filter((p) => p.id);
    if (!products.length) return { added: 0, activityId: ps.activityId };
    await this.panggilTikTok(t, (c) => c.promoUpdateProducts(ps.activityId as string, products));
    return { added: products.length, activityId: ps.activityId };
  }

  // ---------------------------------------------------------- (chat)
  /** Agregat order (jumlah + total) satu toko dlm rentang waktu (bypass RLS, aman utk cron). */
  async ordersAggByShop(userId: string, shopId: string, fromISO: string, toISO: string): Promise<{ n: number; total: number }> {
    const rows = await this.bypass(() => this.db.execute(sql`
      SELECT count(*)::int AS n, COALESCE(sum(total_amount), 0)::float8 AS total
        FROM orders
       WHERE user_id = ${userId} AND shop_id = ${shopId}
         AND created_at_marketplace >= ${fromISO} AND created_at_marketplace < ${toISO}`));
    const r = (rows as unknown as Array<{ n: number; total: number }>)[0] ?? { n: 0, total: 0 };
    return { n: Number(r.n) || 0, total: Number(r.total) || 0 };
  }

  /** Estimasi komisi (fraksi) dari order_settings (bypass). */
  async komisiRate(userId: string): Promise<number> {
    const [o] = await this.bypass(() => this.db.select({ r: orderSettings.estCommissionRate }).from(orderSettings).where(eq(orderSettings.userId, userId)).limit(1));
    return Math.min(0.9, Math.max(0, Number(o?.r ?? 0.08) || 0));
  }

  /** Panggil TikTok utk sebuah toko dgn auto-refresh token sekali saat 401. */
  private async panggilTikTok<T>(t: typeof shops.$inferSelect, fn: (c: TikTokClient) => Promise<T>): Promise<T> {
    let klien = await this.klien(t);
    let segar = false;
    for (;;) {
      try { return await fn(klien); }
      catch (e) {
        if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(t); continue; }
        throw e;
      }
    }
  }

  private async tokoTikTok(userId: string, shopId: string) {
    const [t] = await this.bypass(() => this.db.select().from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId))).limit(1));
    if (!t) throw new NotFoundException("Toko tidak ditemukan");
    if (t.marketplace !== "tiktok" || !t.accessToken || !t.shopCipher)
      throw new BadRequestException("Toko TikTok belum tersambung API");
    return t;
  }

  /** Kirim pesan TEXT ke pembeli via TikTok IM. Return message_id TikTok. */
  async kirimPesanChat(userId: string, shopId: string, conversationCid: string, text: string): Promise<string> {
    const t = await this.tokoTikTok(userId, shopId);
    const resp = await this.panggilTikTok(t, (c) => c.post<{ message_id?: string }>(
      `/customer_service/202309/conversations/${conversationCid}/messages`,
      { type: "TEXT", content: JSON.stringify({ content: text }) },
    ));
    return String(resp?.message_id ?? "");
  }

  /** Buat percakapan baru dgn pembeli (dari order). Return conversation_id TikTok. */
  async buatPercakapanChat(userId: string, shopId: string, buyerUserId: string): Promise<string> {
    const t = await this.tokoTikTok(userId, shopId);
    const resp = await this.panggilTikTok(t, (c) => c.post<{ conversation_id?: string }>(
      `/customer_service/202309/conversations`, { buyer_user_id: String(buyerUserId) },
    ));
    return String(resp?.conversation_id ?? "");
  }

  /** Tandai percakapan sudah dibaca (best-effort). */
  async tandaiDibacaChat(userId: string, shopId: string, conversationCid: string): Promise<void> {
    const t = await this.tokoTikTok(userId, shopId);
    await this.panggilTikTok(t, (c) => c.post(
      `/customer_service/202309/conversations/${conversationCid}/messages/read`, {},
    ));
  }

  /** Tarik pesan satu percakapan dari TikTok -> marketplace_messages (dedupe by id). */
  async syncPesanPercakapan(userId: string, shopId: string, conversationCid: string, ourConvId: string): Promise<number> {
    const t = await this.tokoTikTok(userId, shopId);
    const resp = await this.panggilTikTok(t, (c) => c.get<{ messages?: Record<string, unknown>[] }>(
      `/customer_service/202309/conversations/${conversationCid}/messages`, { page_size: 50 }));
    const list = resp?.messages ?? [];
    if (!list.length) return 0;
    const existing = await this.bypass(() => this.db
      .select({ mid: marketplaceMessages.marketplaceMessageId })
      .from(marketplaceMessages)
      .where(and(eq(marketplaceMessages.conversationId, ourConvId), eq(marketplaceMessages.userId, userId))));
    const seen = new Set(existing.map((r) => r.mid).filter(Boolean) as string[]);
    let added = 0;
    for (const mm of list) {
      const rec = mm as Record<string, any>;
      const mid = String(rec.id ?? "");
      if (!mid || seen.has(mid)) continue;
      const role = String(rec.sender?.role ?? "").toUpperCase();
      const direction = role === "BUYER" ? "in" : "out";
      const sender = role === "BUYER" ? "buyer" : (role === "SYSTEM" || role === "ROBOT") ? "system" : "seller";
      const text = (() => {
        const c = rec.content;
        if (typeof c !== "string") return null;
        try { const o = JSON.parse(c); return typeof o?.content === "string" ? o.content : c; } catch { return c; }
      })();
      const at = rec.create_time ? new Date(Number(rec.create_time) * 1000) : new Date();
      await this.bypass(() => this.db.insert(marketplaceMessages).values({
        userId, conversationId: ourConvId, marketplaceMessageId: mid,
        direction, sender, text, status: direction === "in" ? "received" : "sent", raw: rec, createdAt: at,
      }));
      added += 1;
    }
    return added;
  }

  /**
   * Sinkron percakapan Customer Service (TikTok IM) -> tabel chat kita.
   * READ-ONLY, manual-trigger, DORMAN sampai scope Customer Service aktif;
   * kalau scope belum aktif, TikTok menolak dan kita kembalikan error per toko
   * (tidak crash). Path/param CS API 202309 = best-effort dari kontrak standar
   * (dok SPA tak terbaca via fetch) -> VERIFIKASI saat scope aktif, isolasi di
   * satu tempat ini. Pesan per-percakapan menyusul setelah ini terverifikasi.
   */
  async syncChat(userId: string) {
    const toko = await this.tokoSiap(userId);
    let conversations = 0;
    const hasil: { shop: string; conv: number; error?: string }[] = [];
    for (const t of toko) {
      if (t.marketplace !== "tiktok") continue;
      try {
        let klien = await this.klien(t);
        let segar = false;
        const call = async <T>(fn: (c: TikTokClient) => Promise<T>): Promise<T> => {
          for (;;) {
            try { return await fn(klien); }
            catch (e) {
              if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(t); continue; }
              throw e;
            }
          }
        };
        const resp = await call((c) => c.get<{ conversations?: Record<string, any>[] }>(
          "/customer_service/202309/conversations", { page_size: 20 }));
        const list = resp?.conversations ?? [];
        for (const cv of list) {
          const cid = String(cv.id ?? cv.conversation_id ?? "");
          if (!cid) continue;
          const lm: any = cv.latest_message ?? {};
          const lastText: string | null = (() => {
            const c = lm.content;
            if (typeof c !== "string") return null;
            try { const o = JSON.parse(c); return typeof o?.content === "string" ? o.content : c; } catch { return c; }
          })();
          const lastAt = lm.create_time ? new Date(Number(lm.create_time) * 1000) : null;
          const buyer = cv.buyer_name ?? cv.latest_user_nickname
            ?? (Array.isArray(cv.participants) ? (cv.participants.find((p: any) => p?.role === "BUYER")?.nickname ?? null) : null);
          const unread = Number(cv.unread_count ?? cv.unread ?? 0) || 0;
          await this.bypass(() => this.db
            .insert(marketplaceConversations)
            .values({ userId, shopId: t.id, marketplace: "tiktok", conversationId: cid, buyerName: buyer, lastMessage: lastText, lastMessageAt: lastAt, unread, raw: cv })
            .onConflictDoUpdate({
              target: [marketplaceConversations.userId, marketplaceConversations.marketplace, marketplaceConversations.conversationId],
              set: { shopId: t.id, buyerName: buyer, lastMessage: lastText, lastMessageAt: lastAt, unread, raw: cv, updatedAt: new Date() },
            }));
          conversations++;
        }
        hasil.push({ shop: t.shopName ?? t.id, conv: list.length });
      } catch (e) {
        hasil.push({ shop: t.shopName ?? t.id, conv: 0, error: (e as Error).message });
      }
    }
    return { shops: toko.length, conversations, hasil };
  }

  /**
   * Sinkron retur/refund (Reverse Order 202309) -> tabel kita. READ-ONLY,
   * manual, dorman sampai scope aktif; graceful bila ditolak. Ambil 90 hari
   * terakhir, page pertama (page_size 20).
   */
  async syncReturns(userId: string) {
    const toko = await this.tokoSiap(userId);
    let returns = 0;
    const hasil: { shop: string; ret: number; error?: string }[] = [];
    const since = Math.floor((Date.now() - 90 * 86400000) / 1000);
    for (const t of toko) {
      if (t.marketplace !== "tiktok") continue;
      try {
        let klien = await this.klien(t);
        let segar = false;
        const call = async <T>(fn: (c: TikTokClient) => Promise<T>): Promise<T> => {
          for (;;) {
            try { return await fn(klien); }
            catch (e) {
              if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) { segar = true; klien = await this.segarkan(t); continue; }
              throw e;
            }
          }
        };
        const resp = await call((c) => c.post<{ return_orders?: Record<string, any>[] }>(
          "/return_refund/202309/returns/search",
          { create_time_ge: since },
          { page_size: 20, sort_field: "update_time", sort_order: "DESC" }));
        const list = resp?.return_orders ?? [];
        for (const r of list) {
          const rid = String(r.return_id ?? "");
          if (!rid) continue;
          const ra: any = r.refund_amount ?? {};
          const act: any = Array.isArray(r.seller_next_action_response) ? r.seller_next_action_response[0] : null;
          const values = {
            userId, shopId: t.id, marketplace: "tiktok", returnId: rid,
            orderId: r.order_id ?? null, returnType: r.return_type ?? null,
            returnStatus: r.return_status ?? null, arbitrationStatus: r.arbitration_status ?? null,
            role: r.role ?? null, reasonText: r.return_reason_text ?? null,
            refundTotal: ra.refund_total ?? null, currency: ra.currency ?? null,
            buyerUserId: r.buyer_user_id ?? null, lineItems: (r.return_line_items ?? null) as never,
            sellerNextAction: act?.action ?? null,
            nextActionDeadline: act?.deadline ? new Date(Number(act.deadline) * 1000) : null,
            returnCreateTime: r.create_time ? new Date(Number(r.create_time) * 1000) : null,
            returnUpdateTime: r.update_time ? new Date(Number(r.update_time) * 1000) : null,
            raw: r as never,
          };
          await this.bypass(() => this.db.insert(marketplaceReturns).values(values).onConflictDoUpdate({
            target: [marketplaceReturns.userId, marketplaceReturns.marketplace, marketplaceReturns.returnId],
            set: { ...values, updatedAt: new Date() },
          }));
          returns++;
        }
        hasil.push({ shop: t.shopName ?? t.id, ret: list.length });
      } catch (e) {
        hasil.push({ shop: t.shopName ?? t.id, ret: 0, error: (e as Error).message });
      }
    }
    return { shops: toko.length, returns, hasil };
  }

  /** Daftar retur tersimpan (authed -> ter-skop RLS). */
  async listReturns(userId: string) {
    return this.db
      .select()
      .from(marketplaceReturns)
      .where(eq(marketplaceReturns.userId, userId))
      .orderBy(desc(marketplaceReturns.returnUpdateTime))
      .limit(200);
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
