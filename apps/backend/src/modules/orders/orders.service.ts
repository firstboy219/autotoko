import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders } from "../../database/schema/index.js";

export interface ListOrdersOpts {
  status?: FulfillmentStatus;
  shopId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export const FULFILLMENT_STATUSES = [
  "masuk",
  "approved",
  "produksi",
  "packing",
  "siap_kirim",
  "dikirim",
  "selesai",
  "retur",
  "dibatalkan",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

@Injectable()
export class OrdersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string, opts: ListOrdersOpts = {}) {
    const conds: SQL[] = [eq(orders.userId, userId)];
    if (opts.status) conds.push(eq(orders.fulfillmentStatus, opts.status));
    if (opts.shopId) conds.push(eq(orders.shopId, opts.shopId));
    if (opts.dateFrom) conds.push(gte(orders.createdAt, opts.dateFrom));
    if (opts.dateTo) conds.push(lte(orders.createdAt, opts.dateTo));
    return this.db
      .select()
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.createdAt))
      .limit(Math.min(opts.limit ?? 100, 500))
      .offset(opts.offset ?? 0);
  }

  /** Lightweight counters for the dashboard. */
  async summary(userId: string) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
        feeCharged: sql<string>`coalesce(sum(${orders.platformFee}), 0)`,
      })
      .from(orders)
      .where(eq(orders.userId, userId));
    return row ?? { total: 0, revenue: "0", feeCharged: "0" };
  }

  async get(userId: string, id: string) {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .limit(1);
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  /** Update the internal fulfillment status (multi-tenant guarded). */
  async updateStatus(userId: string, id: string, status: FulfillmentStatus) {
    const [row] = await this.db
      .update(orders)
      .set({ fulfillmentStatus: status, updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException("Order not found");
    return row;
  }
}
