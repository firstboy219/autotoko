import { pgEnum } from "drizzle-orm/pg-core";

export const planTypeEnum = pgEnum("plan_type", ["freemium", "starter", "pro"]);

export const marketplaceEnum = pgEnum("marketplace", [
  "tiktok",
  "shopee",
  "tokopedia",
  "lazada",
]);

export const walletTxTypeEnum = pgEnum("wallet_tx_type", [
  "topup",
  "deduct_subscription",
  "deduct_transaction",
  "deduct_setup",
  "refund",
]);

export const shopStatusEnum = pgEnum("shop_status", [
  "active",
  "deactivated",
  "suspended",
  "disconnected",
]);

export const productStatusEnum = pgEnum("product_status", [
  "active",
  "inactive",
  "draft",
]);

export const healthScoreEnum = pgEnum("health_score", ["A", "B", "C", "D"]);

export const postingStatusEnum = pgEnum("posting_status", [
  "active",
  "inactive",
  "deleted",
  "under_review",
  "banned",
]);

export const restockMethodEnum = pgEnum("restock_method", [
  "wa_owner",
  "wa_supplier",
  "supplier_api",
]);

export const invoiceTypeEnum = pgEnum("invoice_type", [
  "setup_fee",
  "subscription",
  "topup",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "paid",
  "failed",
  "cancelled",
]);

export const affiliateStatusEnum = pgEnum("affiliate_status", [
  "prospect",
  "invited",
  "active",
  "rejected",
  "blacklist",
]);

export const chatTypeEnum = pgEnum("chat_type", ["buyer", "affiliate"]);

export const notifChannelEnum = pgEnum("notif_channel", [
  "wa",
  "email",
  "in_app",
]);

export const waLoginStatusEnum = pgEnum("wa_login_status", [
  "pending",
  "verified",
  "expired",
]);

// Internal fulfillment workflow (PRD / CLAUDE2.md) — distinct from the raw
// marketplace order status stored in orders.status.
export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "masuk",
  "approved",
  "produksi",
  "packing",
  "siap_kirim",
  "dikirim",
  "selesai",
  "retur",
  "dibatalkan",
]);

// --- Payout / Pencairan Dana module (FLOW_PENCAIRAN_V2_FINAL.md) ---

// Which figure the sedekah percentage is taken from (Bagian 3).
export const sedekahBasisEnum = pgEnum("sedekah_basis", [
  "total_credit",
  "after_subseller_split",
  // Both cuts computed on the full credit, independently of each other.
  "both_from_total",
]);

export const subSellerStatusEnum = pgEnum("sub_seller_status", [
  "active",
  "inactive",
]);

// v1 labels (running/awaiting_transfer/transferred/completed) are legacy and no
// longer produced by the app — the Owner-approval stage they represented was
// removed in v2. Postgres cannot drop enum labels, so they stay defined but
// unused; v2 flow uses only berjalan/siap_distribusi/selesai (Bagian 4).
export const payoutBatchStatusEnum = pgEnum("payout_batch_status", [
  "running",
  "awaiting_transfer",
  "transferred",
  "completed",
  "berjalan",
  "siap_distribusi",
  "selesai",
]);

// "completed" now means "locked because the batch's input stage closed"
// (Bagian 4), set automatically — there is no more per-mutation manual
// complete action.
export const payoutMutationStatusEnum = pgEnum("payout_mutation_status", [
  "draft",
  "completed",
]);

// v1-only, no columns reference this anymore (superseded by
// payout_disbursements.validationStatus below) — kept defined, not deleted, so
// drizzle-kit doesn't mistake the new enums below for a rename of this one.
export const payoutForwardStatusEnum = pgEnum("payout_forward_status", [
  "pending",
  "forwarded",
]);

// Per-disbursement transfer validation (payout_disbursements.validationStatus).
// Replaces the old per-mutation forward-status concept entirely.
export const payoutDisbursementRecipientTypeEnum = pgEnum(
  "payout_disbursement_recipient_type",
  // bahan_baku is a batch-level row like sedekah: one consolidated transfer,
  // no single mutation to hang it on.
  ["sedekah", "sub_seller", "sub_sub_seller", "bahan_baku"],
);

export const payoutDisbursementValidationStatusEnum = pgEnum(
  "payout_disbursement_validation_status",
  [
    "belum_upload",
    "cocok_otomatis",
    // Proof uploaded, OCR ran, but amount/account didn't match — staff must
    // either re-upload or override (Bagian 3, Tahap 3).
    "tidak_cocok",
    "override_manual",
  ],
);

// Who connected a shop (MAPPING_DAN_SELFSERVICE_TOKO.md Bagian 3) — distinct
// from who OWNS the split (shops.subSellerId/subSubSellerId): a Seller can
// connect a shop via OAuth and later reassign its ownership to a sub-seller.
export const shopAddedByTypeEnum = pgEnum("shop_added_by_type", [
  "seller",
  "sub_seller",
  "sub_sub_seller",
]);
