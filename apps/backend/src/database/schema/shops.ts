import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  index,
  integer,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { subSellers, subSubSellers } from "./payout";
import { marketplaceEnum, shopStatusEnum, shopAddedByTypeEnum } from "./enums";

// PRD Bagian 9.1 — marketplace shops per user. Tokens stored AES-256 encrypted
// (encryption handled in the app layer; columns are opaque text).
/**
 * Seller-defined grouping for shops.
 *
 * A separate axis from subSellerId/subSubSellerId on the shop itself: those
 * say who earns the commission and drive the payout split, so bending them
 * into a general grouping would tie a bookkeeping label to money movement.
 * This is purely how the owner wants to see their own shops — by brand, by
 * warehouse, by whatever they choose.
 *
 * One category per shop, not many: the request was grouping, and a shop that
 * appears under three headings is no longer a group.
 */
export const shopCategories = pgTable(
  "shop_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    /** Hex, for telling groups apart at a glance. */
    color: varchar("color", { length: 9 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Two categories with the same name defeat the point of grouping, and the
    // owner would have no way to tell them apart in a dropdown.
    userNameUnique: unique("shop_categories_user_name_unique").on(t.userId, t.name),
    userIdx: index("shop_categories_user_idx").on(t.userId),
  }),
);

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
    // Seller-chosen label. Kept SEPARATE from shopName because saveShop()
    // overwrites shopName with whatever the marketplace returns on every
    // reconnect — editing that field directly would silently lose the name.
    // Null = fall back to the marketplace name.
    displayName: varchar("display_name", { length: 255 }),
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

    // --- Payout module: ownership within the hierarchy (FLOW_PENCAIRAN_V2_FINAL.md 3a) ---
    // A shop is created first by the existing OMS/OAuth flow, then assigned.
    // Business rule enforced in the service layer: subSubSellerId must be null
    // when subSellerId is null.
    subSellerId: uuid("sub_seller_id").references(() => subSellers.id, {
      onDelete: "set null",
    }),
    subSubSellerId: uuid("sub_sub_seller_id").references(() => subSubSellers.id, {
      onDelete: "set null",
    }),
    // Per-shop overrides of the entity default rates. Null = inherit.
    rateOverrideSubSeller: numeric("rate_override_sub_seller", { precision: 5, scale: 4 }),
    rateOverrideSubSubSeller: numeric("rate_override_sub_sub_seller", {
      precision: 5,
      scale: 4,
    }),

    // --- Self-service connect (MAPPING_DAN_SELFSERVICE_TOKO.md) ---
    // WHO PERFORMED THE OAUTH CONNECT — distinct from subSellerId/subSubSellerId
    // above (who OWNS the split): a Seller can connect a shop and later
    // reassign its ownership to a sub-seller, so these can diverge.
    addedByType: shopAddedByTypeEnum("added_by_type").notNull().default("seller"),
    addedById: uuid("added_by_id"), // sub_sellers.id or sub_sub_sellers.id, per addedByType

    // Seller's own grouping. set null on delete: removing a category must
    // never take the shops with it.
    categoryId: uuid("category_id").references(() => shopCategories.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    userIdx: index("shops_user_idx").on(t.userId),
    mpShopIdx: index("shops_mp_shop_idx").on(t.marketplace, t.shopId),
    subSellerIdx: index("shops_sub_seller_idx").on(t.subSellerId),
  }),
);
