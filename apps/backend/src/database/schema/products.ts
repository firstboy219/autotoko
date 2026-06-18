import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";
import {
  productStatusEnum,
  healthScoreEnum,
  postingStatusEnum,
  restockMethodEnum,
} from "./enums";

// PRD Bagian 6 — Master Produk = single source of truth, linked to marketplace
// postings via SKU.
export const masterProducts = pgTable(
  "master_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 128 }).notNull(), // primary SKU — links to postings
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    categoryId: integer("category_id"),
    basePrice: numeric("base_price", { precision: 15, scale: 2 }),
    weightGram: integer("weight_gram"),
    images: jsonb("images").$type<string[]>().default([]),
    status: productStatusEnum("status").notNull().default("draft"),
    healthScore: healthScoreEnum("health_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userSkuUnique: unique("master_products_user_sku_unique").on(t.userId, t.sku),
    userIdx: index("master_products_user_idx").on(t.userId),
  }),
);

export const masterProductVariants = pgTable("master_product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  masterProductId: uuid("master_product_id")
    .notNull()
    .references(() => masterProducts.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 128 }).notNull(), // e.g. BBP-001-RED-XL
  variantName: varchar("variant_name", { length: 255 }),
  price: numeric("price", { precision: 15, scale: 2 }),
  stock: integer("stock").notNull().default(0),
  images: jsonb("images").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PRD Bagian 8.6 — Bill of Materials with full restock config.
export const bomItems = pgTable("bom_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  masterProductId: uuid("master_product_id")
    .notNull()
    .references(() => masterProducts.id, { onDelete: "cascade" }),
  materialName: varchar("material_name", { length: 255 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(), // per 1 product
  unit: varchar("unit", { length: 32 }), // meter, gram, pcs
  currentStock: numeric("current_stock", { precision: 10, scale: 3 }).notNull().default("0"),
  minimumThreshold: numeric("minimum_threshold", { precision: 10, scale: 3 }).notNull().default("0"),
  restockMethod: restockMethodEnum("restock_method").notNull().default("wa_owner"),
  supplierName: varchar("supplier_name", { length: 255 }),
  supplierShopeeUrl: varchar("supplier_shopee_url", { length: 1000 }),
  supplierWaNumber: varchar("supplier_wa_number", { length: 32 }),
  supplierApiUrl: varchar("supplier_api_url", { length: 1000 }),
  supplierApiKey: text("supplier_api_key"), // encrypted
  restockQty: numeric("restock_qty", { precision: 10, scale: 3 }),
  restockPrice: numeric("restock_price", { precision: 15, scale: 2 }),
  paymentMethod: varchar("payment_method", { length: 32 }), // QRIS / COD / Transfer
  shippingAddress: text("shipping_address"),
  receiverName: varchar("receiver_name", { length: 255 }),
  receiverPhone: varchar("receiver_phone", { length: 32 }),
  notesForSupplier: text("notes_for_supplier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PRD Bagian 6 — postings (marketplace listings) linked to a master product.
export const productPostings = pgTable(
  "product_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    marketplaceItemId: varchar("marketplace_item_id", { length: 128 }), // item_id / product_id
    marketplaceSku: varchar("marketplace_sku", { length: 128 }), // SKU used on the marketplace
    title: varchar("title", { length: 500 }),
    price: numeric("price", { precision: 15, scale: 2 }),
    stock: integer("stock"),
    status: postingStatusEnum("status").notNull().default("active"),
    views7d: integer("views_7d").notNull().default(0),
    sold7d: integer("sold_7d").notNull().default(0),
    gmv7d: numeric("gmv_7d", { precision: 15, scale: 2 }).notNull().default("0"),
    reviewScore: numeric("review_score", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    masterIdx: index("postings_master_idx").on(t.masterProductId),
    shopIdx: index("postings_shop_idx").on(t.shopId),
    // SKU matching is the heart of master<->posting linking (PRD Bagian 17.4)
    skuIdx: index("postings_mp_sku_idx").on(t.marketplaceSku),
  }),
);
