import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
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
    // The order's fulfillment status before this scan advanced it. Without it
    // an undo would leave the order sitting at "dikirim" with nothing to
    // justify it.
    previousStatus: varchar("previous_status", { length: 32 }),
    deviceLabel: varchar("device_label", { length: 64 }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),

    // --- The photographed label, and what the background OCR made of it.
    // The waybill itself is NOT in here: it comes from the barcode, which is
    // exact. Everything below is best-effort and may stay null forever, which
    // is why the raw text is kept alongside it.
    photoUrl: varchar("photo_url", { length: 255 }),
    barcodeFormat: varchar("barcode_format", { length: 32 }),
    /** none (no photo) | pending | done | failed */
    ocrStatus: varchar("ocr_status", { length: 16 }).notNull().default("none"),
    ocrAttempts: integer("ocr_attempts").notNull().default(0),
    ocrAt: timestamp("ocr_at", { withTimezone: true }),
    ocrText: text("ocr_text"),
    labelOrderNo: varchar("label_order_no", { length: 128 }),
    labelRecipient: varchar("label_recipient", { length: 255 }),
    labelMarketplace: varchar("label_marketplace", { length: 32 }),
    /** [{ name, qty }] read off the label's product block. */
    labelItems: jsonb("label_items").$type<{ name: string; qty: number }[]>(),
  },
  (t) => ({
    userResiUnique: unique("resi_scans_user_resi_unique").on(t.userId, t.resi),
    // The background reader polls on this; without it every tick sequentially
    // scans the whole table as the archive grows.
    ocrQueueIdx: index("resi_scans_ocr_status_idx").on(t.ocrStatus, t.scannedAt),
    userScannedIdx: index("resi_scans_user_scanned_idx").on(t.userId, t.scannedAt),
  }),
);
