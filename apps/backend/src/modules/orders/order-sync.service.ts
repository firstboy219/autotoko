import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orderApiSnapshots, shops } from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { MarketplaceService } from "../../marketplace/marketplace.service.js";

export interface OrderSyncResult {
  shopId: string;
  fetched: number;
  inserted: number;
  updated: number;
}

/**
 * Pulls a shop's orders from the marketplace API into order_api_snapshots — an
 * audit mirror kept SEPARATE from the `orders` table (local/OCR/webhook baseline)
 * so the two can be compared without violating orders' unique constraint or
 * overwriting hand-verified rows.
 */
@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

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

  /** Sync all orders for one connected shop into the audit snapshot table. */
  async syncOrders(userId: string, shopId: string): Promise<OrderSyncResult> {
    const shop = await this.requireConnectedShop(userId, shopId);
    const accessToken = this.crypto.decrypt(shop.accessToken!);
    const orders = await this.marketplace.listOrders(
      shop.marketplace,
      accessToken,
      shop.shopCipher!,
    );

    let inserted = 0;
    let updated = 0;
    const now = new Date();

    for (const o of orders) {
      if (!o.marketplaceOrderId) continue;
      const values = {
        shopId: shop.id,
        marketplace: shop.marketplace,
        marketplaceOrderId: o.marketplaceOrderId,
        status: o.status ?? null,
        buyerName: o.buyerName ?? null,
        totalAmount:
          o.totalAmount != null && Number.isFinite(o.totalAmount) ? String(o.totalAmount) : null,
        shippingCourier: o.shippingCourier ?? null,
        trackingNumber: o.trackingNumber ?? null,
        paymentMethod: o.paymentMethod ?? null,
        items: (o.items as unknown) ?? null,
        raw: (o.raw as unknown) ?? null,
        createdAtMarketplace: o.createdAtMarketplace
          ? new Date(o.createdAtMarketplace * 1000)
          : null,
        apiSyncedAt: now,
      };

      const [existing] = await this.db
        .select({ id: orderApiSnapshots.id })
        .from(orderApiSnapshots)
        .where(
          and(
            eq(orderApiSnapshots.shopId, shop.id),
            eq(orderApiSnapshots.marketplaceOrderId, o.marketplaceOrderId),
          ),
        )
        .limit(1);

      if (existing) {
        await this.db
          .update(orderApiSnapshots)
          .set(values)
          .where(eq(orderApiSnapshots.id, existing.id));
        updated++;
      } else {
        await this.db.insert(orderApiSnapshots).values(values);
        inserted++;
      }
    }

    await this.db.update(shops).set({ lastSyncAt: now }).where(eq(shops.id, shop.id));

    const result: OrderSyncResult = {
      shopId: shop.shopId,
      fetched: orders.length,
      inserted,
      updated,
    };
    this.logger.log(
      `Order sync ${shop.marketplace} shop ${shop.shopId}: ` +
        `fetched=${result.fetched} ins=${inserted} upd=${updated}`,
    );
    return result;
  }

  /** API order snapshots for a shop the caller owns (audit view). */
  async listSnapshots(userId: string, shopId: string) {
    await this.requireConnectedShop(userId, shopId);
    return this.db
      .select({
        marketplaceOrderId: orderApiSnapshots.marketplaceOrderId,
        status: orderApiSnapshots.status,
        buyerName: orderApiSnapshots.buyerName,
        totalAmount: orderApiSnapshots.totalAmount,
        shippingCourier: orderApiSnapshots.shippingCourier,
        trackingNumber: orderApiSnapshots.trackingNumber,
        createdAtMarketplace: orderApiSnapshots.createdAtMarketplace,
        apiSyncedAt: orderApiSnapshots.apiSyncedAt,
      })
      .from(orderApiSnapshots)
      .where(eq(orderApiSnapshots.shopId, shopId))
      .orderBy(desc(orderApiSnapshots.createdAtMarketplace));
  }
}
