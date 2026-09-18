import {
  boolean,
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
import { masterProducts } from "./products.js";

/**
 * Master Postingan — template listing yang diikuti semua toko.
 *
 * Berbeda dari master_products (unit produk/inventori/HPP internal): master
 * posting adalah materi listing marketplace (nama, deskripsi, gambar, atribut)
 * plus grup varian (Warna/Size/Tipe) yang kombinasinya membentuk SKU unik.
 * Tiap SKU yang terbentuk DIPETAKAN ke satu master_products. Saat master
 * posting diperbarui, seluruh listing marketplace yang termapping ikut
 * diperbarui — tetapi hanya lewat aksi eksplisit "Terapkan" (tulisan keluar).
 *
 * Tanpa RLS (mengikuti master_products); tenancy dijaga filter user_id di
 * service. Aditif; tidak mengubah tabel lama.
 */
export const masterPostings = pgTable(
  "master_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    categoryId: integer("category_id"),
    brand: varchar("brand", { length: 255 }),
    /** Daftar gambar berurutan (URL). Urutan = urutan tampil di marketplace. */
    images: jsonb("images").$type<string[]>().notNull().default([]),
    /** Grup varian terstruktur: [{ name:"Warna", values:["Biru","Merah"] }, ...] */
    variantGroups: jsonb("variant_groups")
      .$type<{ name: string; values: string[] }[]>()
      .notNull()
      .default([]),
    /** Detail lain: berat, dimensi, paket, atribut kategori, dll. */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    /** Terapkan otomatis ke marketplace tiap disimpan? Default MATI (aman). */
    autoApply: boolean("auto_apply").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("master_postings_user_idx").on(t.userId),
  }),
);

/**
 * SKU unik hasil kombinasi varian. Satu baris per kombinasi (mis. Biru×M).
 * combo_key = nilai tiap grup (urut grup) digabung "|" → dedup & idempoten.
 * master_product_id = pemetaan SKU ini ke master produk AutoToko.
 */
export const masterPostingSkus = pgTable(
  "master_posting_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    masterPostingId: uuid("master_posting_id")
      .notNull()
      .references(() => masterPostings.id, { onDelete: "cascade" }),
    combo: jsonb("combo").$type<Record<string, string>>().notNull().default({}),
    comboKey: varchar("combo_key", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 128 }),
    masterProductId: uuid("master_product_id").references(() => masterProducts.id, {
      onDelete: "set null",
    }),
    price: numeric("price", { precision: 15, scale: 2 }),
    stock: integer("stock"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    comboUnik: uniqueIndex("master_posting_skus_combo_unik").on(t.masterPostingId, t.comboKey),
    postingIdx: index("master_posting_skus_posting_idx").on(t.masterPostingId),
    masterIdx: index("master_posting_skus_master_idx").on(t.masterProductId),
  }),
);

/**
 * Pemetaan master posting → satu listing marketplace di sebuah toko.
 * product_id = id produk/item di marketplace yang akan dikendalikan.
 * last_* = jejak "Terapkan" terakhir (kapan, hasil, pesan).
 */
export const masterPostingMappings = pgTable(
  "master_posting_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    masterPostingId: uuid("master_posting_id")
      .notNull()
      .references(() => masterPostings.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    marketplace: varchar("marketplace", { length: 32 }).notNull(),
    productId: varchar("product_id", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("mapped"),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    lastStatus: varchar("last_status", { length: 20 }),
    lastMessage: text("last_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("master_posting_mappings_unik").on(t.masterPostingId, t.shopId, t.productId),
    postingIdx: index("master_posting_mappings_posting_idx").on(t.masterPostingId),
    shopIdx: index("master_posting_mappings_shop_idx").on(t.shopId),
  }),
);
