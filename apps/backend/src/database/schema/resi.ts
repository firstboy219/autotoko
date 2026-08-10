import {
  boolean,
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
import { shops } from "./shops.js";
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
/*
 * Confirmation lives on the scan, not on its lines.
 *
 * "Every line has a product" is not the same statement as "somebody looked at
 * this parcel and says that is what was in it" — the first is satisfied by a
 * lucky OCR match nobody read.
 */

/**
 * Every barcode seen while scanning one parcel.
 *
 * A courier label carries several. Whichever was in frame became the resi, so
 * the same parcel could be recorded repeatedly under different numbers — and
 * consume its raw materials each time. Two scans of one parcel overlap on at
 * least one code even when the numbers they settled on differ, which is what
 * makes this a workable identity where a single code is not.
 */
/**
 * What the camera read, and what a person said it was.
 *
 * A memory rather than a model. Similarity can reason its way from "Reralus
 * Swak Spey Mih" to "Mouthspray Siwak"; nothing reasons its way from "Bagels
 * Gyreani He" to "Inhaler Regular Peppermint", and a person has already
 * answered that one.
 */
export const ocrCorrections = pgTable(
  "ocr_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** product | material */
    kind: varchar("kind", { length: 16 }).notNull(),
    /** Lower case, alphanumerics, single spaces. */
    rawNorm: varchar("raw_norm", { length: 255 }).notNull(),
    /** Kept readable: a normalised key cannot explain a guess to a person. */
    rawText: text("raw_text"),
    /** master_products.id or materials.id, per kind. Null for a courier. */
    targetId: uuid("target_id"),
    /**
     * The answer when it is not a row.
     *
     * A courier is one of nine names and there is no table of them — the list
     * is the same for every seller in the country, so it lives in code.
     */
    targetText: varchar("target_text", { length: 64 }),
    /** Answering the same reading again strengthens it rather than duplicating. */
    hits: integer("hits").notNull().default(1),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index("ocr_corrections_lookup_idx").on(t.userId, t.kind, t.hits),
    uniq: unique("ocr_corrections_unique").on(t.userId, t.kind, t.rawNorm, t.targetId),
  }),
);

export const resiScanCodes = pgTable(
  "resi_scan_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => resiScans.id, { onDelete: "cascade" }),
    /** Normalised like resi: upper case, alphanumerics only. */
    code: varchar("code", { length: 64 }).notNull(),
    format: varchar("format", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index("resi_scan_codes_lookup_idx").on(t.userId, t.code),
    scanIdx: index("resi_scan_codes_scan_idx").on(t.scanId),
  }),
);

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
    /** device_auto | device_confirmed | manual — how this line was decided. */
    source: varchar("source", { length: 16 }),
    /**
     * 0-1, how close the label's wording was to the master product's name.
     *
     * Kept because the dangerous failure here is a confident wrong match:
     * "Cool Mint 100ml" and "Cool Mint Spray 50ml" differ by a few characters
     * that OCR routinely swaps. A score on the row makes a bad auto-match
     * findable afterwards instead of invisible.
     */
    matchScore: numeric("match_score", { precision: 4, scale: 3 }),
    rawQty: numeric("raw_qty", { precision: 10, scale: 2 }),
    /** The quantity the operator stands behind. */
    qty: numeric("qty", { precision: 10, scale: 2 }).notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scanIdx: index("resi_scan_items_scan_idx").on(t.resiScanId),
  }),
);

/**
 * Extra sheets of one waybill.
 *
 * Some orders print across two or three pages — the courier's label, then a
 * continuation carrying the rest of the product table. They share one waybill
 * number, so the duplicate guard correctly refuses the second sheet as an
 * already-scanned parcel, and the pages holding half the products were never
 * photographed at all.
 *
 * Page 1 stays on resi_scans.photoUrl. Moving it here would rewrite every read
 * path for no gain: one page is still the ordinary case, and this table is
 * simply empty for it.
 */
export const resiScanPhotos = pgTable(
  "resi_scan_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resiScanId: uuid("resi_scan_id")
      .notNull()
      .references(() => resiScans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    photoUrl: varchar("photo_url", { length: 255 }).notNull(),
    /** 2 for the first extra sheet; page 1 is the photo on the scan itself. */
    pageNo: integer("page_no").notNull().default(2),
    /** What the phone read off THIS sheet, if it read anything. */
    deviceText: text("device_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scanIdx: index("resi_scan_photos_scan_idx").on(t.resiScanId),
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

    // --- What the PHONE read, kept apart from the server's reading.
    //
    // Two engines see the same label: ML Kit on the handset across dozens of
    // live frames, and tesseract on the server from one JPEG. One column for
    // both would destroy the comparison, and the comparison is the point — it
    // is how we find out whether reading on the device is actually better,
    // rather than assuming it.
    deviceText: text("device_text"),
    /** Sharpness the scanner's own meter reported at capture, 0-100. */
    deviceClarity: numeric("device_clarity", { precision: 5, scale: 2 }),
    /**
     * When a person said what was in the parcel — not when a machine guessed.
     *
     * Null is the outstanding state. Nothing downstream consumes stock from a
     * scan's contents on the strength of an OCR match alone, because the
     * dangerous failure here is a confident wrong one.
     */
    /**
     * Which of the seller's shops this parcel went out from.
     *
     * Null while nobody has said. Kept apart from labelSenderName, which is
     * what OCR read off the label — when a mapping turns out wrong that text
     * is the only way to see what the machine was looking at.
     */
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    /**
     * Confirmed marketplace. Redundant when shopId is set, and not redundant
     * when the shop is one the seller never registered — which on a channel
     * they sell through by hand is most of them.
     */
    marketplace: varchar("marketplace", { length: 24 }),
    /** What a person says the courier is; `courier` above is the guess. */
    courierConfirmed: varchar("courier_confirmed", { length: 32 }),
    /**
     * When somebody said where this parcel came from.
     *
     * Separate from itemsConfirmedAt: checking the contents happens at the
     * bench, and knowing which of four Shopee accounts a label belongs to may
     * not. One flag for both would let either stand in for the other.
     */
    mappingConfirmedAt: timestamp("mapping_confirmed_at", { withTimezone: true }),
    mappingConfirmedBy: varchar("mapping_confirmed_by", { length: 64 }),
    itemsConfirmedAt: timestamp("items_confirmed_at", { withTimezone: true }),
    /** Which phone or operator confirmed it; a floor runs several. */
    itemsConfirmedBy: varchar("items_confirmed_by", { length: 64 }),
    /** 0-100, as tesseract reported it. On these photos it runs 32-50. */
    ocrConfidence: numeric("ocr_confidence", { precision: 5, scale: 2 }),

    // Everything the label prints, read off four real photographs: the sending
    // shop and its city, the recipient with area and street, the service
    // level, weight, COD flag, the courier's sortation code, the order and
    // package ids, the buyer's nickname, the product table and its total.
    //
    // All nullable and expected to stay that way for a while. Tesseract reads
    // the large print sometimes and the small print never, so in practice
    // these are filled in by the operator on the Produksi & Packing page. The
    // columns exist so that both routes have somewhere to put an answer.
    labelOrderNo: varchar("label_order_no", { length: 128 }),
    labelRecipient: varchar("label_recipient", { length: 255 }),
    labelRecipientArea: varchar("label_recipient_area", { length: 200 }),
    labelRecipientAddress: varchar("label_recipient_address", { length: 400 }),
    /** The seller's own shop name, as the courier prints it under "Pengirim". */
    labelSenderName: varchar("label_sender_name", { length: 160 }),
    labelSenderArea: varchar("label_sender_area", { length: 160 }),
    labelMarketplace: varchar("label_marketplace", { length: 32 }),
    /** Courier service level: ECO, EZ, REG. */
    labelService: varchar("label_service", { length: 32 }),
    labelWeightKg: numeric("label_weight_kg", { precision: 10, scale: 3 }),
    labelCod: boolean("label_cod"),
    /** J&T's destination sortation code, e.g. "260-BKH08-05". */
    labelSortCode: varchar("label_sort_code", { length: 48 }),
    labelPackageId: varchar("label_package_id", { length: 64 }),
    labelBuyerNickname: varchar("label_buyer_nickname", { length: 120 }),
    labelQtyTotal: numeric("label_qty_total", { precision: 10, scale: 2 }),
    labelShipDate: varchar("label_ship_date", { length: 32 }),
    /** [{ name, qty }] read off the label's product block. */
    labelItems: jsonb("label_items").$type<{ name: string; qty: number }[]>(),
    /**
     * Set the moment a human corrects any label field. The background reader
     * checks it and leaves those columns alone: a re-read exists to improve on
     * a machine guess, never to overwrite a correction.
     */
    labelEditedAt: timestamp("label_edited_at", { withTimezone: true }),

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
