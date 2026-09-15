import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { orders } from "./orders.js";

/**
 * Verifikasi packing (Fase 1, scan-verify). Satu baris TERAKHIR per order:
 * apakah isi paket dicek cocok dengan pesanan sebelum dikirim. Diisi dari APK
 * (aksi lapangan), dipantau di web. RLS per user_id (migrasi 0063).
 */
export const packingVerifications = pgTable(
  "packing_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    /** 'ok' = semua item cocok; 'discrepancy' = ada selisih. */
    status: varchar("status", { length: 16 }).notNull(),
    /** Snapshot pengecekan: [{ name, sku, expected, checked }]. */
    items: jsonb("items"),
    note: text("note"),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("packing_verifications_unik").on(t.userId, t.orderId),
    userIdx: index("packing_verifications_user_idx").on(t.userId),
  }),
);
