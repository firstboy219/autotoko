import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { shops } from "./shops.js";

/**
 * Cache/riwayat kupon TikTok (migrasi 0082). API kupon TikTok READ-ONLY, jadi
 * tabel ini diisi oleh sinkron berkala untuk tampilan cepat + rekap + deteksi
 * sinyal otomasi. Tenancy dijaga filter user_id di service.
 */
export const marketplaceCoupons = pgTable(
  "marketplace_coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    couponId: varchar("coupon_id", { length: 64 }).notNull(),
    title: text("title"),
    status: varchar("status", { length: 24 }),
    displayType: varchar("display_type", { length: 24 }),
    productScope: varchar("product_scope", { length: 32 }),
    targetBuyerSegment: varchar("target_buyer_segment", { length: 32 }),
    creationSource: varchar("creation_source", { length: 32 }),
    discountType: varchar("discount_type", { length: 24 }),
    discountAmount: numeric("discount_amount", { precision: 15, scale: 2 }),
    discountPct: numeric("discount_pct", { precision: 6, scale: 2 }),
    maxDiscount: numeric("max_discount", { precision: 15, scale: 2 }),
    currency: varchar("currency", { length: 8 }),
    minSpend: numeric("min_spend", { precision: 15, scale: 2 }),
    claimStart: timestamp("claim_start", { withTimezone: true }),
    claimEnd: timestamp("claim_end", { withTimezone: true }),
    redemptionLimit: integer("redemption_limit"),
    perBuyerLimit: integer("per_buyer_limit"),
    claimedCount: integer("claimed_count").notNull().default(0),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("marketplace_coupons_unik").on(t.userId, t.couponId),
    userIdx: index("marketplace_coupons_user_idx").on(t.userId, t.status),
  }),
);

/** Pengaturan otomasi kupon per seller (migrasi 0082). Default pantauan AKTIF. */
export const couponSettings = pgTable("coupon_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  autoSync: boolean("auto_sync").notNull().default(true),
  alertExpiry: boolean("alert_expiry").notNull().default(true),
  expiryDays: smallint("expiry_days").notNull().default(3),
  alertLimit: boolean("alert_limit").notNull().default(true),
  limitPct: smallint("limit_pct").notNull().default(80),
  alertZeroClaim: boolean("alert_zero_claim").notNull().default(true),
  zeroClaimDays: smallint("zero_claim_days").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
