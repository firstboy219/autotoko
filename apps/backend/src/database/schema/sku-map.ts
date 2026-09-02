import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { masterProducts } from "./products.js";

/**
 * Terjemahan ID SKU marketplace -> produk di katalog.
 *
 * Laporan penyelesaian menyebut isi tiap pesanan sebagai ID SKU
 * ("1731350028413076965 * 1;"), bukan nama, dan ID itu tidak muncul di mana
 * pun selain laporannya sendiri. Tanpa peta ini, layar audit hanya bisa
 * menampilkan deretan angka yang tidak berarti apa-apa bagi pembacanya.
 *
 * Isinya keputusan manusia, bukan hasil tebakan sistem: harga tidak cukup
 * untuk membedakan produk di katalog ini (39.300 dipakai dua produk, 49.300
 * dipakai tiga), jadi sistem hanya menyarankan dan penggunanya yang memutuskan.
 */
export const marketplaceSkuMap = pgTable(
  "marketplace_sku_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ID SKU hanya unik di dalam satu marketplace. */
    marketplace: varchar("marketplace", { length: 32 }).notNull(),
    /** Sebagaimana tertulis di laporan, apa adanya. */
    sku: varchar("sku", { length: 128 }).notNull(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    /** Pemetaan adalah keputusan; siapa yang memutuskan harus bisa ditelusuri. */
    mappedBy: uuid("mapped_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("marketplace_sku_map_unik").on(t.userId, t.marketplace, t.sku),
    produkIdx: index("marketplace_sku_map_produk_idx").on(t.masterProductId),
  }),
);
