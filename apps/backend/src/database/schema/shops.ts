import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { marketplaceEnum, shopStatusEnum } from "./enums";

// PRD Bagian 9.1 — marketplace shops per user. Tokens stored AES-256 encrypted
// (encryption handled in the app layer; columns are opaque text).
export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marketplace: marketplaceEnum("marketplace").notNull(),
    shopId: varchar("shop_id", { length: 128 }).notNull(), // id from marketplace
    shopName: varchar("shop_name", { length: 255 }),
    shopCipher: varchar("shop_cipher", { length: 255 }), // TikTok only
    openId: varchar("open_id", { length: 255 }), // TikTok only
    merchantId: varchar("merchant_id", { length: 255 }), // Shopee only
    sellerRegion: varchar("seller_region", { length: 8 }), // ID, US, ...
    accessToken: text("access_token"), // encrypted
    accessTokenExpireAt: timestamp("access_token_expire_at", { withTimezone: true }),
    refreshToken: text("refresh_token"), // encrypted
    refreshTokenExpireAt: timestamp("refresh_token_expire_at", { withTimezone: true }),
    shopStatus: shopStatusEnum("shop_status").notNull().default("active"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("shops_user_idx").on(t.userId),
    mpShopIdx: index("shops_mp_shop_idx").on(t.marketplace, t.shopId),
  }),
);
