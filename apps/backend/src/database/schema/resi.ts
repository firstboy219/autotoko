import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
  varchar,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { orders } from "./orders";
import { masterProducts } from "./products";

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
/**
 * Per-tenant packing/production payroll settings.
 *
 * Deliberately NOT the same field as costing_settings.packing_cost_per_order.
 * That one is the packing cost that feeds HPP — box, tape, bubble wrap AND
 * labour — and is used to price the product. This one is only what the packer
 * is actually handed per parcel. Paying out the HPP figure would overpay by
 * the cost of the materials; folding them together would make one of the two
 * numbers wrong the first time either changes.
 */
export const packingSettings = pgTable("packing_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Rupiah paid to the packer per parcel handed to the courier. */
  feePerResi: numeric("fee_per_resi", { precision: 15, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What was actually inside one parcel, mapped to the seller's own products.
 *
 * OCR seeds this where it can, but it is not the source of truth and on real
 * photographs it frequently finds nothing at all — every scan recorded so far
 * has an empty label_items. So the operator maps: the label may say
 * "mouthspray siwak x3" and they point it at "Mouthspray Siwak 100ml", or they
 * add a line OCR never saw. Automatic name matching was deliberately left out;
 * the seller's product names and the marketplace's rarely agree closely enough
 * for a guess to be trustworthy, and a wrong mapping is worse than an empty
 * one because nobody re-checks it.
 *
 * rawName/rawQty keep what OCR read even after the mapping is corrected, so
 * the two can be compared later to see where the reading goes wrong.
 */
export const resiScanItems = pgTable(
  "resi_scan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resiScanId: uuid("resi_scan_id")
      .notNull()
      .references(() => resiScans.id, { onDelete: "cascade" }),
    /** Null until the operator maps it; a line can exist unmapped. */
    masterProductId: uuid("master_product_id").references(() => masterProducts.id, {
      onDelete: "set null",
    }),
    /** Exactly what OCR read, kept for comparison. Null for a hand-added line. */
    rawName: varchar("raw_name", { length: 255 }),
    rawQty: numeric("raw_qty", { precision: 10, scale: 2 }),
    /** The quantity the operator stands behind. */
    qty: numeric("qty", { precision: 10, scale: 2 }).notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scanIdx: index("resi_scan_items_scan_idx").on(t.resiScanId),
  }),
);

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

    // --- Packing wage. Paying per parcel means the record of what was paid
    // has to live on the parcel.
    packerPaidAt: timestamp("packer_paid_at", { withTimezone: true }),
    /**
     * The rate that was actually paid for THIS parcel, frozen at payment time.
     * Reading the current rate instead would quietly restate every past
     * payslip the moment the rate changes.
     */
    packerPaidAmount: numeric("packer_paid_amount", { precision: 15, scale: 2 }),
    packerNote: varchar("packer_note", { length: 120 }),

    // What the courier said about this waybill when it was scanned. Stored raw
    // so a status our keyword list does not know is visible in the data rather
    // than silently collapsed into "unknown".
    trackingStatus: varchar("tracking_status", { length: 120 }),
    trackingCategory: varchar("tracking_category", { length: 24 }),
    trackingCheckedAt: timestamp("tracking_checked_at", { withTimezone: true }),
  },
  (t) => ({
    userResiUnique: unique("resi_scans_user_resi_unique").on(t.userId, t.resi),
    // The background reader polls on this; without it every tick sequentially
    // scans the whole table as the archive grows.
    ocrQueueIdx: index("resi_scans_ocr_status_idx").on(t.ocrStatus, t.scannedAt),
    paidIdx: index("resi_scans_packer_paid_idx").on(t.userId, t.packerPaidAt),
    userScannedIdx: index("resi_scans_user_scanned_idx").on(t.userId, t.scannedAt),
  }),
);
