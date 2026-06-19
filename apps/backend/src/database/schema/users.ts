import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  numeric,
  integer,
} from "drizzle-orm/pg-core";
import { planTypeEnum, walletTxTypeEnum, waLoginStatusEnum } from "./enums";

// PRD Bagian 9.1 — USERS. Identity = WhatsApp number or email (no password).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).unique(),
  whatsapp: varchar("whatsapp", { length: 32 }).unique(),
  fullName: varchar("full_name", { length: 255 }),
  planType: planTypeEnum("plan_type").notNull().default("freemium"),
  planStartedAt: timestamp("plan_started_at", { withTimezone: true }),
  planExpiredAt: timestamp("plan_expired_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  isSuspended: boolean("is_suspended").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Wallet/balance — one per user (PRD Bagian 4.2).
export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  balance: numeric("balance", { precision: 15, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).notNull().default("IDR"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletTransactions = pgTable("wallet_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallets.id, { onDelete: "cascade" }),
  type: walletTxTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 15, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 15, scale: 2 }).notNull(),
  referenceId: varchar("reference_id", { length: 255 }), // order_id / invoice_id
  description: varchar("description", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Short-lived WA login sessions (PRD Bagian 3.2). Codes also cached in Redis TTL 5m;
// this table is the durable record / audit.
export const waLoginSessions = pgTable("wa_login_sessions", {
  code: varchar("code", { length: 20 }).primaryKey(),
  waNumber: varchar("wa_number", { length: 32 }),
  status: waLoginStatusEnum("status").notNull().default("pending"),
  callbackToken: varchar("callback_token", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

// Short-lived email OTP login sessions (PRD Bagian 3 — passwordless via email).
// The 6-digit code is stored hashed; verified rows upsert a user by email.
export const emailOtpSessions = pgTable("email_otp_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull(),
  codeHash: varchar("code_hash", { length: 128 }).notNull(),
  status: waLoginStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});
