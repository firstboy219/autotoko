import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { fulfillmentApiSnapshots, shops } from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { MarketplaceService } from "../../marketplace/marketplace.service.js";

export interface FulfillmentSyncResult {
  shopId: string;
  fetched: number;
  inserted: number;
  updated: number;
}

/**
 * Pulls a shop's fulfillment packages from the marketplace API into
 * fulfillment_api_snapshots — an audit mirror kept separate from the local
 * resi/OCR data, which is never touched.
 */
@Injectable()
export class FulfillmentSyncService {
  private readonly logger = new Logger(FulfillmentSyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly marketplace: MarketplaceService,
  ) {}

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

  /** Sync all packages for one connected shop into the audit snapshot table. */
  async syncFulfillment(userId: string, shopId: string): Promise<FulfillmentSyncResult> {
    const shop = await this.requireConnectedShop(userId, shopId);
    const accessToken = this.crypto.decrypt(shop.accessToken!);
    const packages = await this.marketplace.listPackages(
      shop.marketplace,
      accessToken,
      shop.shopCipher!,
    );

    let inserted = 0;
    let updated = 0;
    const now = new Date();

    for (const p of packages) {
      if (!p.packageId) continue;
      const values = {
        shopId: shop.id,
        marketplace: shop.marketplace,
        packageId: p.packageId,
        marketplaceOrderId: p.orderId ?? null,
        status: p.status ?? null,
        trackingNumber: p.trackingNumber ?? null,
        shippingProvider: p.shippingProvider ?? null,
        raw: (p.raw as unknown) ?? null,
        updatedAtMarketplace: p.updatedAtMarketplace
          ? new Date(p.updatedAtMarketplace * 1000)
          : null,
        apiSyncedAt: now,
      };

      const [existing] = await this.db
        .select({ id: fulfillmentApiSnapshots.id })
        .from(fulfillmentApiSnapshots)
        .where(
          and(
            eq(fulfillmentApiSnapshots.shopId, shop.id),
            eq(fulfillmentApiSnapshots.packageId, p.packageId),
          ),
        )
        .limit(1);

      if (existing) {
        await this.db
          .update(fulfillmentApiSnapshots)
          .set(values)
          .where(eq(fulfillmentApiSnapshots.id, existing.id));
        updated++;
      } else {
        await this.db.insert(fulfillmentApiSnapshots).values(values);
        inserted++;
      }
    }

    await this.db.update(shops).set({ lastSyncAt: now }).where(eq(shops.id, shop.id));

    const result: FulfillmentSyncResult = {
      shopId: shop.shopId,
      fetched: packages.length,
      inserted,
      updated,
    };
    this.logger.log(
      `Fulfillment sync ${shop.marketplace} shop ${shop.shopId}: ` +
        `fetched=${result.fetched} ins=${inserted} upd=${updated}`,
    );
    return result;
  }

  /** API package snapshots for a shop the caller owns (audit view). */
  async listSnapshots(userId: string, shopId: string) {
    await this.requireConnectedShop(userId, shopId);
    return this.db
      .select({
        packageId: fulfillmentApiSnapshots.packageId,
        marketplaceOrderId: fulfillmentApiSnapshots.marketplaceOrderId,
        status: fulfillmentApiSnapshots.status,
        trackingNumber: fulfillmentApiSnapshots.trackingNumber,
        shippingProvider: fulfillmentApiSnapshots.shippingProvider,
        updatedAtMarketplace: fulfillmentApiSnapshots.updatedAtMarketplace,
        apiSyncedAt: fulfillmentApiSnapshots.apiSyncedAt,
      })
      .from(fulfillmentApiSnapshots)
      .where(eq(fulfillmentApiSnapshots.shopId, shopId))
      .orderBy(desc(fulfillmentApiSnapshots.updatedAtMarketplace));
  }
}
