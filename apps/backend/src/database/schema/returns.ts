import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { shops } from "./shops.js";

/**
 * Retur/refund marketplace (Fase 1, Reverse Order API 202309). Diisi oleh
 * sinkron POST /return_refund/202309/returns/search; UI memantaunya. RLS per
 * user_id (migrasi 0063_returns).
 */
export const marketplaceReturns = pgTable(
  "marketplace_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    marketplace: varchar("marketplace", { length: 32 }).notNull().default("tiktok"),
    returnId: varchar("return_id", { length: 128 }).notNull(),
    orderId: varchar("order_id", { length: 64 }),
    returnType: varchar("return_type", { length: 48 }),
    returnStatus: varchar("return_status", { length: 64 }),
    arbitrationStatus: varchar("arbitration_status", { length: 48 }),
    role: varchar("role", { length: 24 }),
    reasonText: text("reason_text"),
    refundTotal: numeric("refund_total", { precision: 15, scale: 2 }),
    currency: varchar("currency", { length: 8 }),
    buyerUserId: varchar("buyer_user_id", { length: 64 }),
    lineItems: jsonb("line_items"),
    sellerNextAction: varchar("seller_next_action", { length: 64 }),
    nextActionDeadline: timestamp("next_action_deadline", { withTimezone: true }),
    returnCreateTime: timestamp("return_create_time", { withTimezone: true }),
    returnUpdateTime: timestamp("return_update_time", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("marketplace_returns_unik").on(t.userId, t.marketplace, t.returnId),
    userIdx: index("marketplace_returns_user_idx").on(t.userId),
  }),
);
