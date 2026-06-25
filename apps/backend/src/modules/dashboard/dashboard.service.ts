import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, lte, lt, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  orders,
  shops,
  wallets,
  bomItems,
  masterProducts,
} from "../../database/schema/index.js";

const WALLET_LOW_THRESHOLD = 150000; // IDR; below this → low-wallet alert
const TOKEN_EXPIRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // warn 3 days ahead

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** UTC instant of today's 00:00 in Asia/Jakarta (UTC+7, no DST). */
  private jakartaStartOfDay(): Date {
    const now = Date.now();
    const jak = new Date(now + 7 * 3600 * 1000);
    return new Date(
      Date.UTC(jak.getUTCFullYear(), jak.getUTCMonth(), jak.getUTCDate()) - 7 * 3600 * 1000,
    );
  }

  /** Seller dashboard headline numbers (PRD Bagian 12 — dashboard). */
  async summary(userId: string) {
    const start = this.jakartaStartOfDay();

    const [today] = await this.db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.userId, userId), gte(orders.createdAt, start)));

    const [all] = await this.db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
        feeCharged: sql<string>`coalesce(sum(${orders.platformFee}), 0)`,
      })
      .from(orders)
      .where(eq(orders.userId, userId));

    const [activeShops] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(and(eq(shops.userId, userId), eq(shops.shopStatus, "active")));

    return {
      today_orders: today?.orders ?? 0,
      today_revenue: today?.revenue ?? "0",
      active_shops: activeShops?.count ?? 0,
      total_orders: all?.orders ?? 0,
      total_revenue: all?.revenue ?? "0",
      total_fee_charged: all?.feeCharged ?? "0",
    };
  }

  /** Actionable alert cards: low BOM stock, low wallet, soon-expiring tokens. */
  async alerts(userId: string) {
    // Low stock — bom_items whose master belongs to the user.
    const lowStockRows = await this.db
      .select({
        id: bomItems.id,
        name: bomItems.materialName,
        current: bomItems.currentStock,
        min: bomItems.minimumThreshold,
        unit: bomItems.unit,
      })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(
        and(
          eq(masterProducts.userId, userId),
          lte(bomItems.currentStock, bomItems.minimumThreshold),
        ),
      );
    const low_stock = lowStockRows.map((r) => ({
      id: r.id,
      name: r.name,
      current: Number(r.current),
      min: Number(r.min),
      unit: r.unit,
    }));

    // Low wallet.
    const [wallet] = await this.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    const balance = Number(wallet?.balance ?? 0);
    const low_wallet =
      balance < WALLET_LOW_THRESHOLD
        ? { balance, threshold: WALLET_LOW_THRESHOLD }
        : null;

    // Expiring marketplace tokens (within the next 3 days).
    const cutoff = new Date(Date.now() + TOKEN_EXPIRY_WINDOW_MS);
    const expRows = await this.db
      .select({
        shop_id: shops.id,
        shop_name: shops.shopName,
        expires_at: shops.accessTokenExpireAt,
      })
      .from(shops)
      .where(
        and(
          eq(shops.userId, userId),
          eq(shops.shopStatus, "active"),
          lt(shops.accessTokenExpireAt, cutoff),
        ),
      );
    const expiring_tokens = expRows.map((r) => ({
      shop_id: r.shop_id,
      shop_name: r.shop_name,
      expires_at: r.expires_at,
    }));

    return { low_stock, low_wallet, expiring_tokens };
  }
}
