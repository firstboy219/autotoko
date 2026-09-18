import { pgTable, uuid, varchar, boolean, numeric, integer, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";

/** Pengaturan promosi per toko: auto-ikut (enroll produk ke activity) + target + diskon default. */
export const promotionSettings = pgTable(
  "promotion_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    autoJoin: boolean("auto_join").notNull().default(false),
    activityId: varchar("activity_id", { length: 128 }),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("10"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uq: unique("promotion_settings_user_shop_uq").on(t.userId, t.shopId) }),
);

/** Otomasi Promosi per user (evaluasi promo -> perpanjang/replikasi bila positif). */
export const promotionAutomation = pgTable("promotion_automation", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  dryRun: boolean("dry_run").notNull().default(true),
  onlyOngoing: boolean("only_ongoing").notNull().default(true),
  minUpliftPct: numeric("min_uplift_pct", { precision: 6, scale: 2 }).notNull().default("10"),
  requireProfit: boolean("require_profit").notNull().default(true),
  minOrders: integer("min_orders").notNull().default(5),
  autoExtend: boolean("auto_extend").notNull().default(false),
  extendDays: integer("extend_days").notNull().default(7),
  autoReplicate: boolean("auto_replicate").notNull().default(false),
  replicateDiscountPct: numeric("replicate_discount_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastResult: jsonb("last_result"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
