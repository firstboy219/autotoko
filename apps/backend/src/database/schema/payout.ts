import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  date,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";
import {
  sedekahBasisEnum,
  subSellerStatusEnum,
  payoutBatchStatusEnum,
  payoutMutationStatusEnum,
  payoutForwardStatusEnum,
  payoutDisbursementRecipientTypeEnum,
  payoutDisbursementValidationStatusEnum,
} from "./enums";

/**
 * Payout / Pencairan Dana (FLOW_PENCAIRAN_V2_FINAL.md — supersedes the v1 flow
 * that had an Owner-approval stage; that stage is gone, replaced by per-recipient
 * disbursements the input staff transfers and proves directly).
 *
 * Tenancy note: this project has no separate tenant table — the tenant IS a row
 * in `users` (see shops.userId / wallets.userId). Every table here therefore
 * carries `user_id` so the existing RLS on `app.user_id` covers it unchanged.
 * `sub_sub_sellers` denormalises `user_id` from its parent for the same reason.
 *
 * Money follows the wallet convention: numeric(15,2), computed in integer cents
 * in the service layer. Rates are numeric(5,4) — 0.2000 means 20%.
 */

// Sub-seller: owns marketplace shops, hands management to the Seller tenant.
export const subSellers = pgTable(
  "sub_sellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    contact: varchar("contact", { length: 64 }),
    // Reserved for the sub-seller passwordless login portal.
    loginEmail: varchar("login_email", { length: 255 }),
    bankAccount: varchar("bank_account", { length: 255 }),
    // Share of the remainder after sedekah, e.g. 0.2000 = 20%.
    defaultRate: numeric("default_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2000"),
    // Max shops this sub-seller may self-connect. Null = unlimited
    // (MAPPING_DAN_SELFSERVICE_TOKO.md 2.2).
    kuotaTokoMaksimal: integer("kuota_toko_maksimal"),
    status: subSellerStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("sub_sellers_user_idx").on(t.userId),
    // Login lookup is global (across tenants), like users.email — must be
    // unique so a portal login attempt resolves to exactly one entity.
    loginEmailIdx: uniqueIndex("sub_sellers_login_email_uidx")
      .on(t.loginEmail)
      .where(sql`${t.loginEmail} is not null`),
  }),
);

// Sub-sub-seller: sits under exactly one sub-seller. Max depth of the hierarchy.
export const subSubSellers = pgTable(
  "sub_sub_sellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subSellerId: uuid("sub_seller_id")
      .notNull()
      .references(() => subSellers.id, { onDelete: "cascade" }),
    // Denormalised from the parent so RLS/tenant filters stay uniform.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    contact: varchar("contact", { length: 64 }),
    loginEmail: varchar("login_email", { length: 255 }),
    bankAccount: varchar("bank_account", { length: 255 }),
    // Share taken out of the parent sub-seller's cut, e.g. 0.5000 = 50%.
    defaultRate: numeric("default_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.5000"),
    kuotaTokoMaksimal: integer("kuota_toko_maksimal"),
    status: subSellerStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index("sub_sub_sellers_parent_idx").on(t.subSellerId),
    userIdx: index("sub_sub_sellers_user_idx").on(t.userId),
    loginEmailIdx: uniqueIndex("sub_sub_sellers_login_email_uidx")
      .on(t.loginEmail)
      .where(sql`${t.loginEmail} is not null`),
  }),
);

// Per-tenant payout configuration (Bagian 3). One row per tenant.
export const payoutSettings = pgTable("payout_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  sedekahRate: numeric("sedekah_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.0500"),
  sedekahBasis: sedekahBasisEnum("sedekah_basis").notNull().default("total_credit"),
  sedekahBankAccount: varchar("sedekah_bank_account", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A batch groups per-shop pencairan records into one unit of work (Bagian 1).
// v2 lifecycle: berjalan (input open, any number of shops) -> siap_distribusi
// (input locked, payout_disbursements generated) -> selesai (every disbursement
// validated/overridden). No Owner-approval stage in between.
//
// closedAt/totalTransferToAdmin/transferProofUrl/transferredAt are v1-only
// fields from the removed Owner-approval stage. They are kept (not dropped —
// avoids an enum/column-rename migration ambiguity for no real benefit) but no
// longer written by v2 code; `closedAt` is repurposed to mean "input stage
// closed" (semantically the closest v1 field), and a NEW `completedAt` marks
// when "Tutup Batch" fully settles the batch.
export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // No DB default: Postgres cannot reference a brand-new enum value (e.g.
    // "berjalan") in a DEFAULT clause within the same migration transaction
    // that adds it. The service layer always sets this explicitly on insert.
    status: payoutBatchStatusEnum("status").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // v1-only, unused by v2 — see note above.
    totalTransferToAdmin: numeric("total_transfer_to_admin", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    transferProofUrl: text("transfer_proof_url"),
    transferredAt: timestamp("transferred_at", { withTimezone: true }),
    // When "Tutup Batch" was clicked (all disbursements settled) — new in v2.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("payout_batches_user_status_idx").on(t.userId, t.status),
  }),
);

// One pencairan record per shop within a batch (Tahap 1). Split shares are
// computed at input time (for the real-time preview) and read back verbatim
// when the batch closes its input stage to generate payout_disbursements —
// v2 does not recompute the split with different logic at close time, it only
// changes what happens AFTER the split is known (direct per-recipient transfer
// instead of a gathered Owner transfer).
export const payoutMutations = pgTable(
  "payout_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),

    payoutDate: date("payout_date").notNull(),
    // The split calculation basis — since the UX merge, this IS
    // marketplaceProofAmount (no more separate "Nominal Kredit" input); kept
    // as its own column so historical rows and the split-invariant math don't
    // need to change, but the two are now always written together, equal.
    marketplaceProofAmount: numeric("marketplace_proof_amount", { precision: 15, scale: 2 }),
    creditAmount: numeric("credit_amount", { precision: 15, scale: 2 }).notNull(),
    // What Titik 1 OCR originally suggested for marketplaceProofAmount, BEFORE
    // any manual correction — a snapshot taken once at create() time, never
    // touched by update(). If this differs from the final marketplaceProofAmount
    // that was saved, the staff corrected an OCR misread; comparing the two
    // (ocrSuggestedAmount vs marketplaceProofAmount) is exactly the training
    // signal for future OCR tuning. Null = OCR found nothing / wasn't used.
    ocrSuggestedAmount: numeric("ocr_suggested_amount", { precision: 15, scale: 2 }),
    receivingAccount: varchar("receiving_account", { length: 255 }),
    marketplaceProofUrl: text("marketplace_proof_url"),
    // Raw OCR read of the pencairan proof (Titik 1) — audit trail, never the
    // sole source of truth; staff can always override the extracted fields.
    ocrRawResult: jsonb("ocr_raw_result"),

    // Rate snapshots — later rate edits must never alter historical records.
    sedekahRateUsed: numeric("sedekah_rate_used", { precision: 5, scale: 4 }).notNull(),
    sedekahBasisUsed: sedekahBasisEnum("sedekah_basis_used").notNull(),
    subSellerRateUsed: numeric("sub_seller_rate_used", { precision: 5, scale: 4 }),
    subSubSellerRateUsed: numeric("sub_sub_seller_rate_used", { precision: 5, scale: 4 }),

    // Who the money belonged to at the time of the transaction.
    subSellerId: uuid("sub_seller_id").references(() => subSellers.id, {
      onDelete: "set null",
    }),
    subSubSellerId: uuid("sub_sub_seller_id").references(() => subSubSellers.id, {
      onDelete: "set null",
    }),

    // Computed shares. Invariant enforced in the service layer:
    // sedekah + seller + subSeller + subSubSeller === creditAmount, exactly.
    sedekahAmount: numeric("sedekah_amount", { precision: 15, scale: 2 }).notNull(),
    sellerAmount: numeric("seller_amount", { precision: 15, scale: 2 }).notNull(),
    subSellerAmount: numeric("sub_seller_amount", { precision: 15, scale: 2 }),
    subSubSellerAmount: numeric("sub_sub_seller_amount", { precision: 15, scale: 2 }),

    // v1-only, unused by v2 (superseded by payout_disbursements) — kept, not
    // dropped, to avoid a migration rename ambiguity for no real benefit.
    sedekahTransferProofUrl: text("sedekah_transfer_proof_url"),
    sellerTransferProofUrl: text("seller_transfer_proof_url"),
    subSellerTransferProofUrl: text("sub_seller_transfer_proof_url"),
    subSubSellerTransferProofUrl: text("sub_sub_seller_transfer_proof_url"),
    subSellerForwardStatus: payoutForwardStatusEnum("sub_seller_forward_status"),
    subSubSellerForwardStatus: payoutForwardStatusEnum("sub_sub_seller_forward_status"),

    // OMS level-1 integration: an audit trail only, never used to derive amounts.
    orderRefIds: jsonb("order_ref_ids"),

    // "completed" = locked because the batch's input stage closed (set in bulk
    // by closeInput, not by a per-mutation manual action).
    status: payoutMutationStatusEnum("status").notNull().default("draft"),

    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    batchIdx: index("payout_mutations_batch_idx").on(t.batchId),
    userDateIdx: index("payout_mutations_user_date_idx").on(t.userId, t.payoutDate),
    shopIdx: index("payout_mutations_shop_idx").on(t.shopId),
  }),
);

// One outgoing transfer from the holding account to ONE recipient (Bagian 4,
// replaces the old per-mutation forward-status + gathered proof columns).
// Generated when the batch's input stage closes: one row per
// sub_seller/sub_sub_seller recipient PER MUTATION (shops owned that way),
// plus exactly ONE consolidated sedekah row for the whole batch — sedekah
// is paid out once, not once per shop, so it isn't tied to any single
// mutation (payoutMutationId null, batchId set instead — see below).
export const payoutDisbursements = pgTable(
  "payout_disbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: sedekah is now paid out ONCE per batch (one consolidated
    // transfer covering every shop's sedekah share), not once per shop, so
    // that row has no single mutation to point at — see batchId below. Every
    // sub_seller/sub_sub_seller row still ties to exactly one mutation.
    payoutMutationId: uuid("payout_mutation_id").references(() => payoutMutations.id, {
      onDelete: "cascade",
    }),
    // Set ONLY on the consolidated sedekah row generated by closeInput() — the
    // batch it belongs to, since payoutMutationId can't carry that here.
    batchId: uuid("batch_id").references(() => payoutBatches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientType: payoutDisbursementRecipientTypeEnum("recipient_type").notNull(),
    recipientSubSellerId: uuid("recipient_sub_seller_id").references(() => subSellers.id, {
      onDelete: "set null",
    }),
    recipientSubSubSellerId: uuid("recipient_sub_sub_seller_id").references(
      () => subSubSellers.id,
      { onDelete: "set null" },
    ),
    expectedAmount: numeric("expected_amount", { precision: 15, scale: 2 }).notNull(),
    // Snapshot of the recipient's bank account AT GENERATION TIME, so a later
    // change to the entity's master bank account doesn't retroactively alter
    // historical disbursement records.
    recordedAccount: varchar("recorded_account", { length: 255 }),

    proofUrl: text("proof_url"),
    ocrAmount: numeric("ocr_amount", { precision: 15, scale: 2 }),
    ocrAccount: varchar("ocr_account", { length: 255 }),
    ocrRawResult: jsonb("ocr_raw_result"),

    validationStatus: payoutDisbursementValidationStatusEnum("validation_status")
      .notNull()
      .default("belum_upload"),
    // Required by the service layer when validationStatus = override_manual.
    overrideReason: text("override_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mutationIdx: index("payout_disbursements_mutation_idx").on(t.payoutMutationId),
    batchIdx: index("payout_disbursements_batch_idx").on(t.batchId),
    userIdx: index("payout_disbursements_user_idx").on(t.userId),
  }),
);

// Corrections to a locked mutation — the original row is never edited.
export const payoutAdjustments = pgTable(
  "payout_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mutationId: uuid("mutation_id")
      .notNull()
      .references(() => payoutMutations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Signed: negative corrects an overpayment.
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mutationIdx: index("payout_adjustments_mutation_idx").on(t.mutationId),
  }),
);
