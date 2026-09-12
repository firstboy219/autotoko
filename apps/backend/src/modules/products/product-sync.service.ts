import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterProducts,
  productPostings,
  shops,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { MarketplaceService } from "../../marketplace/marketplace.service.js";

export interface ProductSyncResult {
  shopId: string;
  fetched: number;
  inserted: number;
  updated: number;
  autoLinked: number;
  pendingReview: number;
}

/**
 * Pulls a shop's product catalog from the marketplace API and mirrors it into
 * product_postings as source="api" rows. It NEVER touches source="manual" rows
 * (the hand-entered audit baseline) — API and manual postings coexist so the two
 * can be compared and reconciled via the review/merge flow below.
 */
@Injectable()
export class ProductSyncService {
  private readonly logger = new Logger(ProductSyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly marketplace: MarketplaceService,
  ) {}

  /** Load a shop the caller owns and assert it can serve signed API calls. */
  private async requireConnectedShop(userId: string, shopId: string) {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    if (shop.shopStatus !== "active" || !shop.accessToken) {
      throw new BadRequestException("Toko belum tersambung / token tidak tersedia");
    }
    if (!shop.shopCipher) {
      throw new BadRequestException("Toko tidak punya shop_cipher (perlu sambung ulang)");
    }
    return shop;
  }

  /** Sync all products for one connected shop. Read-only against the API. */
  async syncProducts(userId: string, shopId: string): Promise<ProductSyncResult> {
    const shop = await this.requireConnectedShop(userId, shopId);
    const accessToken = this.crypto.decrypt(shop.accessToken!);
    const products = await this.marketplace.listProducts(
      shop.marketplace,
      accessToken,
      shop.shopCipher!,
    );

    // Master SKUs for this user, to auto-link API rows on the way in.
    const masters = await this.db
      .select({ id: masterProducts.id, sku: masterProducts.sku })
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId));
    const masterBySku = new Map(masters.map((m) => [m.sku, m.id]));

    let inserted = 0;
    let updated = 0;
    let autoLinked = 0;
    let pendingReview = 0;
    const now = new Date();

    for (const p of products) {
      const marketplaceItemId = p.marketplaceItemId ?? "";
      if (!marketplaceItemId) continue;
      const linkedMasterId = p.sku ? masterBySku.get(p.sku) ?? null : null;
      if (linkedMasterId) autoLinked++;
      else pendingReview++;

      const values = {
        shopId: shop.id,
        marketplaceItemId,
        marketplaceSku: p.sku || null,
        title: p.title || null,
        price: Number.isFinite(p.price) ? String(p.price) : null,
        stock: Number.isFinite(p.stock) ? p.stock : null,
        source: "api" as const,
        raw: p.raw ?? null,
        apiSyncedAt: now,
        lastSyncedAt: now,
      };

      // Upsert keyed by (shop, marketplace item) among API rows only — manual
      // rows for the same item are left untouched.
      const [existing] = await this.db
        .select({ id: productPostings.id, masterProductId: productPostings.masterProductId })
        .from(productPostings)
        .where(
          and(
            eq(productPostings.shopId, shop.id),
            eq(productPostings.marketplaceItemId, marketplaceItemId),
            eq(productPostings.source, "api"),
          ),
        )
        .limit(1);

      if (existing) {
        // Keep a master link a user already made; only auto-fill if still empty.
        const masterProductId = existing.masterProductId ?? linkedMasterId;
        await this.db
          .update(productPostings)
          .set({ ...values, masterProductId })
          .where(eq(productPostings.id, existing.id));
        updated++;
      } else {
        await this.db
          .insert(productPostings)
          .values({ ...values, masterProductId: linkedMasterId });
        inserted++;
      }
    }

    await this.db.update(shops).set({ lastSyncAt: now }).where(eq(shops.id, shop.id));

    const result: ProductSyncResult = {
      shopId: shop.shopId,
      fetched: products.length,
      inserted,
      updated,
      autoLinked,
      pendingReview,
    };
    this.logger.log(
      `Product sync ${shop.marketplace} shop ${shop.shopId}: ` +
        `fetched=${result.fetched} ins=${inserted} upd=${updated} ` +
        `linked=${autoLinked} pending=${pendingReview}`,
    );
    return result;
  }

  /**
   * API-sourced postings not yet linked to a master — the review queue. Scoped to
   * the caller's shops (product_postings has no RLS, so we join ownership here).
   */
  async listPending(userId: string) {
    return this.db
      .select({
        id: productPostings.id,
        shopId: productPostings.shopId,
        shopName: shops.shopName,
        marketplaceItemId: productPostings.marketplaceItemId,
        marketplaceSku: productPostings.marketplaceSku,
        title: productPostings.title,
        price: productPostings.price,
        stock: productPostings.stock,
        apiSyncedAt: productPostings.apiSyncedAt,
      })
      .from(productPostings)
      .innerJoin(shops, eq(productPostings.shopId, shops.id))
      .where(
        and(
          eq(shops.userId, userId),
          eq(productPostings.source, "api"),
          isNull(productPostings.masterProductId),
        ),
      )
      .orderBy(desc(productPostings.apiSyncedAt));
  }

  /**
   * Merge an API posting onto a master product. Either link to an existing
   * master (`masterProductId`) or create a new master from the posting.
   */
  async merge(
    userId: string,
    postingId: string,
    opts: { masterProductId?: string; createMaster?: boolean },
  ): Promise<{ postingId: string; masterProductId: string }> {
    // Ownership check via the posting's shop.
    const [posting] = await this.db
      .select({
        id: productPostings.id,
        marketplaceSku: productPostings.marketplaceSku,
        title: productPostings.title,
        price: productPostings.price,
      })
      .from(productPostings)
      .innerJoin(shops, eq(productPostings.shopId, shops.id))
      .where(and(eq(productPostings.id, postingId), eq(shops.userId, userId)))
      .limit(1);
    if (!posting) throw new NotFoundException("Posting tidak ditemukan");

    let masterId = opts.masterProductId ?? null;

    if (masterId) {
      const [m] = await this.db
        .select({ id: masterProducts.id })
        .from(masterProducts)
        .where(and(eq(masterProducts.id, masterId), eq(masterProducts.userId, userId)))
        .limit(1);
      if (!m) throw new NotFoundException("Master produk tidak ditemukan");
    } else if (opts.createMaster) {
      const sku = posting.marketplaceSku;
      if (!sku) throw new BadRequestException("Posting tidak punya SKU untuk membuat master");
      const [created] = await this.db
        .insert(masterProducts)
        .values({
          userId,
          sku,
          name: posting.title || sku,
          basePrice: posting.price ?? null,
          status: "active",
        })
        .returning({ id: masterProducts.id });
      masterId = created!.id;
    } else {
      throw new BadRequestException("Berikan masterProductId atau createMaster=true");
    }

    await this.db
      .update(productPostings)
      .set({ masterProductId: masterId })
      .where(eq(productPostings.id, postingId));

    this.logger.log(`Merged posting ${postingId} → master ${masterId} (user ${userId})`);
    return { postingId, masterProductId: masterId! };
  }
}
