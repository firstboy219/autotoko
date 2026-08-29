import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";

/**
 * Apa kata marketplace, disimpan terpisah dari apa yang dicatat manusia.
 *
 * Hari ini diisi dengan mengimpor berkas laporan penyelesaian yang diunduh
 * sendiri (source = 'report_import'); nanti diisi API (source = 'api').
 * Bentuk barisnya sama, jadi rekonsiliasi yang dibangun di atasnya tidak perlu
 * ditulis ulang ketika API menyala.
 *
 * Tabel ini TIDAK PERNAH menulis ke payout_mutations. Manual tetap sumber yang
 * dipakai menghitung uang; ini alat memeriksanya.
 */
export const marketplaceStatements = pgTable(
  "marketplace_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Boleh null: laporan bisa diunggah sebelum tokonya dipetakan. */
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    marketplace: varchar("marketplace", { length: 24 }).notNull(),
    source: varchar("source", { length: 24 }).notNull().default("report_import"),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    currency: varchar("currency", { length: 8 }),
    fileName: varchar("file_name", { length: 255 }),
    /** Isi berkasnya: unduhan ulang laporan yang sama bernama berbeda. */
    fileHash: text("file_hash"),
    settlementAmount: numeric("settlement_amount", { precision: 15, scale: 2 }),
    totalIncome: numeric("total_income", { precision: 15, scale: 2 }),
    totalFees: numeric("total_fees", { precision: 15, scale: 2 }),
    rawSummary: jsonb("raw_summary"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopIdx: index("marketplace_statements_shop_idx").on(t.userId, t.shopId, t.periodFrom),
  }),
);

/** Satu baris = satu kejadian yang dilaporkan marketplace. */
export const marketplaceStatementLines = pgTable(
  "marketplace_statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => marketplaceStatements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** withdrawal | earnings | adjustment */
    kind: varchar("kind", { length: 24 }).notNull(),
    /** Nomor referensi milik marketplace; kunci anti-ganda saat impor ulang. */
    externalRef: varchar("external_ref", { length: 64 }),
    occurredOn: date("occurred_on").notNull(),
    /** Apa adanya: negatif berarti keluar dari saldo. */
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    bankAccount: varchar("bank_account", { length: 64 }),
    status: varchar("status", { length: 32 }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index("marketplace_statement_lines_lookup_idx").on(
      t.userId,
      t.kind,
      t.occurredOn,
    ),
  }),
);
