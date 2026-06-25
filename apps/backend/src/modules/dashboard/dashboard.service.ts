import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders, shops } from "../../database/schema/index.js";

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
}
