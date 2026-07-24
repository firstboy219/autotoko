import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";
import {
  sedekahBasisEnum,
  subSellerStatusEnum,
  payoutBatchStatusEnum,
  payoutMutationStatusEnum,
  payoutForwardStatusEnum,
} from "./enums";

/**
 * Payout / Pencairan Dana (PAYOUT_MODULE_REQUIREMENT.md).
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
    // Reserved for the read-only sub-seller portal (deferred to a later phase).
    loginEmail: varchar("login_email", { length: 255 }),
    bankAccount: varchar("bank_account", { length: 255 }),
    // Share of the remainder after sedekah, e.g. 0.2000 = 20%.
    defaultRate: numeric("default_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2000"),
    status: subSellerStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("sub_sellers_user_idx").on(t.userId),
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
    status: subSellerStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index("sub_sub_sellers_parent_idx").on(t.subSellerId),
    userIdx: index("sub_sub_sellers_user_idx").on(t.userId),
  }),
);

// Per-tenant payout configuration (requirement 5.4). One row per tenant.
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

// A batch groups mutations into one unit of work (requirement 6.1).
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
    status: payoutBatchStatusEnum("status").notNull().default("running"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Sum of the shares the tenant must forward on (sub-seller + sub-sub-seller).
    totalTransferToAdmin: numeric("total_transfer_to_admin", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    transferProofUrl: text("transfer_proof_url"),
    transferredAt: timestamp("transferred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("payout_batches_user_status_idx").on(t.userId, t.status),
  }),
);

// One settlement payout from one shop, already split across the hierarchy.
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
    // What the marketplace proof screenshot says vs what we actually split on.
    // They may differ; the UI warns but does not block (requirement 6.3).
    marketplaceProofAmount: numeric("marketplace_proof_amount", { precision: 15, scale: 2 }),
    creditAmount: numeric("credit_amount", { precision: 15, scale: 2 }).notNull(),
    receivingAccount: varchar("receiving_account", { length: 255 }),
    marketplaceProofUrl: text("marketplace_proof_url"),

    // Rate snapshots — later rate edits must never alter historical records
    // (requirement 4.1).
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

    sedekahTransferProofUrl: text("sedekah_transfer_proof_url"),
    sellerTransferProofUrl: text("seller_transfer_proof_url"),
    subSellerTransferProofUrl: text("sub_seller_transfer_proof_url"),
    subSubSellerTransferProofUrl: text("sub_sub_seller_transfer_proof_url"),

    // OMS level-1 integration: an audit trail only, never used to derive amounts
    // (requirement 8).
    orderRefIds: jsonb("order_ref_ids"),

    status: payoutMutationStatusEnum("status").notNull().default("draft"),
    subSellerForwardStatus: payoutForwardStatusEnum("sub_seller_forward_status"),
    subSubSellerForwardStatus: payoutForwardStatusEnum("sub_sub_seller_forward_status"),

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

// Corrections to a completed mutation — the original row is never edited
// (requirement 6.2).
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
