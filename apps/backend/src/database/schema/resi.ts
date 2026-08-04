import {
  index,
  pgTable,
  uuid,
  varchar,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { orders } from "./orders";

/**
 * One row per resi (waybill) recorded from the warehouse scanner app.
 *
 * "The same resi cannot be entered twice" is enforced by the UNIQUE index
 * below, not by a read-then-write check in the service. Two packers scanning
 * the same label at the same moment would both pass an application-level
 * "does it exist yet?" test and both insert; the database constraint is the
 * only thing that actually holds under that race. The service catches the
 * unique violation and turns it into a 409 describing the earlier scan.
 *
 * Uniqueness is per user (tenant), not global: two different sellers can
 * legitimately hold packages with colliding courier numbering.
 *
 * `resi` is the normalised key (upper case, alphanumerics only) and `resiRaw`
 * keeps exactly what OCR read, so a support question about a bad scan can be
 * answered without guessing what the camera actually saw.
 */
export const resiScans = pgTable(
  "resi_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resi: varchar("resi", { length: 64 }).notNull(),
    resiRaw: varchar("resi_raw", { length: 128 }),
    courier: varchar("courier", { length: 32 }),
    // Best-effort link: orders only carry a tracking number once a
    // marketplace sync fills one in, and today none do. A scan is therefore
    // valid on its own and this stays null rather than blocking the packer.
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    source: varchar("source", { length: 16 }).notNull().default("ocr"),
    deviceLabel: varchar("device_label", { length: 64 }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userResiUnique: unique("resi_scans_user_resi_unique").on(t.userId, t.resi),
    userScannedIdx: index("resi_scans_user_scanned_idx").on(t.userId, t.scannedAt),
  }),
);
