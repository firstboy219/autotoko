import {
  index,
  integer,
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
 * Apa kata marketplace tentang produk dan SKU-nya, disimpan apa adanya.
 *
 * Bukan product_postings: tabel itu mensyaratkan master_product_id, sedangkan
 * produk yang baru ditarik belum tentu punya padanan di katalog -- dan
 * memaksakan padanan berarti menebak. Padanan tetap keputusan manusia lewat
 * marketplace_sku_map; tabel ini hanya membuat keputusan itu punya nama untuk
 * dibaca, bukan deretan angka.
 */
/**
 * Katalog: kumpulan postingan yang merupakan PRODUK yang sama lintas toko.
 *
 * Dikelompokkan dari kesamaan judul (match_key) atau ditata manual. Satu level
 * di atas postingan; postingan menunjuk ke sini lewat catalog_id.
 */
export const marketplaceCatalogs = pgTable(
  "marketplace_catalogs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    note: text("note"),
    /** Kunci judul ternormalisasi untuk auto-group; null bila dibuat manual. */
    matchKey: varchar("match_key", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("marketplace_catalogs_user_idx").on(t.userId),
    keyIdx: index("marketplace_catalogs_key_idx").on(t.userId, t.matchKey),
  }),
);

export const marketplaceProducts = pgTable(
  "marketplace_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    marketplace: varchar("marketplace", { length: 32 }).notNull(),
    productId: varchar("product_id", { length: 64 }).notNull(),
    title: text("title"),
    status: varchar("status", { length: 40 }),
    raw: jsonb("raw"),
    updatedAtMarketplace: timestamp("updated_at_marketplace", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    /** Katalog yang menaungi postingan ini; null = belum dikelompokkan. */
    catalogId: uuid("catalog_id").references(() => marketplaceCatalogs.id, { onDelete: "set null" }),
  },
  (t) => ({
    unik: uniqueIndex("marketplace_products_unik").on(t.userId, t.marketplace, t.productId),
    shopIdx: index("marketplace_products_shop_idx").on(t.shopId),
    catalogIdx: index("marketplace_products_catalog_idx").on(t.catalogId),
  }),
);

/**
 * SKU: kunci yang menghubungkan laporan penyelesaian ("Detail produk
 * terjual"), pesanan (line_items.sku_id), dan katalog (marketplace_sku_map).
 *
 * Nama SKU tidak ada di daftar produk tapi ADA di line item pesanan, jadi
 * diisi dari mana pun ia pertama terlihat dan tidak ditimpa null sesudahnya.
 */
export const marketplaceSkus = pgTable(
  "marketplace_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    marketplace: varchar("marketplace", { length: 32 }).notNull(),
    productId: varchar("product_id", { length: 64 }),
    skuId: varchar("sku_id", { length: 64 }).notNull(),
    sellerSku: varchar("seller_sku", { length: 128 }),
    skuName: varchar("sku_name", { length: 255 }),
    productName: varchar("product_name", { length: 500 }),
    price: numeric("price", { precision: 15, scale: 2 }),
    currency: varchar("currency", { length: 8 }),
    stock: integer("stock"),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("marketplace_skus_unik").on(t.userId, t.marketplace, t.skuId),
    shopIdx: index("marketplace_skus_shop_idx").on(t.shopId),
  }),
);

/**
 * Catatan tiap sinkronisasi. Tanpa ini "sudah sinkron?" hanya bisa dijawab
 * dengan menebak dari jumlah baris, dan sinkronisasi bertahap tidak punya
 * titik lanjut (watermark) yang bisa dipercaya.
 */
export const marketplaceSyncRuns = pgTable(
  "marketplace_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    marketplace: varchar("marketplace", { length: 32 }).notNull(),
    /** 'orders' | 'products' */
    kind: varchar("kind", { length: 16 }).notNull(),
    /** 'running' | 'ok' | 'failed' */
    status: varchar("status", { length: 16 }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Batas bawah update_time yang diminta pada run ini. */
    since: timestamp("since", { withTimezone: true }),
    /** update_time terbesar yang terlihat; titik lanjut run berikutnya. */
    watermark: timestamp("watermark", { withTimezone: true }),
    pages: integer("pages").notNull().default(0),
    fetched: integer("fetched").notNull().default(0),
    upserted: integer("upserted").notNull().default(0),
    error: text("error"),
    /** 'cron' | 'manual' */
    triggeredBy: varchar("triggered_by", { length: 16 }).notNull().default("manual"),
  },
  (t) => ({
    shopIdx: index("marketplace_sync_runs_shop_idx").on(t.shopId, t.kind, t.startedAt),
  }),
);
