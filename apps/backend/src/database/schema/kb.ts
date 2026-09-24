import { boolean, index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Knowledge Base balasan otomatis milik tiap seller ("AI internal").
 *
 * Tidak memakai API vendor. Pencocokan kata kunci LOKAL atas KB yang ditulis
 * seller sendiri, lalu isi placeholder dari data order ({resi}, {status},
 * {pembeli}, {toko}). Dipakai untuk menyusun DRAF balasan chat pembeli & review
 * — draf tinggal disunting/dikirim (kirim ke pembeli aktif begitu scope CS ada).
 */
export const kbEntries = pgTable(
  "kb_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull().default("chat"), // chat | review
    /** Kata kunci pemicu, dipisah koma/spasi. */
    keywords: text("keywords").notNull(),
    answer: text("answer").notNull(),
    priority: integer("priority").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index("kb_entries_user_idx").on(t.userId, t.kind) }),
);
