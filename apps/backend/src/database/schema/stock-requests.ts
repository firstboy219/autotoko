import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { materials } from "./products.js";

/**
 * Permintaan pembelian stok, dikirim ke pemasok lewat WhatsApp.
 *
 * TABEL SENDIRI, bukan menumpang material_purchases. Sebuah permintaan bukan
 * pembelian: barangnya belum datang, stoknya belum boleh bertambah, dan
 * harganya belum boleh masuk perhitungan HPP. Menumpang tabel pembelian
 * berarti stok naik pada saat permintaan dibuat -- angka yang salah di rak dan
 * di HPP sekaligus, dan salahnya tidak terlihat sampai ada yang menghitung
 * fisik.
 */
export const stockRequests = pgTable(
  "stock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Wajib. Permintaan tanpa tangkapan layar tidak bisa diperiksa ulang oleh
     * siapa pun sesudahnya -- termasuk oleh yang membuatnya minggu depan.
     */
    screenshotUrl: varchar("screenshot_url", { length: 1024 }).notNull(),
    note: text("note"),
    /** draft | dikirim */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index("stock_requests_user_idx").on(t.userId) }),
);

export const stockRequestItems = pgTable(
  "stock_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => stockRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Boleh kosong: bahan yang belum ada di master tetap boleh diminta, dan
     * memaksa membuat masternya dulu akan menghentikan orang di tengah
     * pekerjaan yang sedang mereka kerjakan.
     */
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    /** Apa yang tertulis di tangkapan layar marketplace. */
    rawName: varchar("raw_name", { length: 255 }),

    /** Yang dibeli, dalam satuan penjual: 2 botol. */
    qtyPack: numeric("qty_pack", { precision: 15, scale: 3 }).notNull().default("1"),
    packLabel: varchar("pack_label", { length: 32 }),
    /** Isi tiap kemasan: 1 liter. */
    contentPerPack: numeric("content_per_pack", { precision: 15, scale: 3 }),
    contentUnit: varchar("content_unit", { length: 16 }),

    /**
     * Hasil terjemahannya ke satuan master: 2000 ml.
     *
     * Disimpan, bukan dihitung ulang saat dibaca: aturan konversi bisa
     * berubah, sedangkan yang sudah dipesan kemarin tidak.
     */
    qtyBase: numeric("qty_base", { precision: 15, scale: 3 }),
    baseUnit: varchar("base_unit", { length: 16 }),

    unitPrice: numeric("unit_price", { precision: 15, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 15, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ reqIdx: index("stock_request_items_req_idx").on(t.requestId) }),
);
