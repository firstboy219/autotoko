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
