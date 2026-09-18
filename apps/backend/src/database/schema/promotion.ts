import { pgTable, uuid, varchar, boolean, numeric, timestamp, unique } from "drizzle-orm/pg-core";
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
