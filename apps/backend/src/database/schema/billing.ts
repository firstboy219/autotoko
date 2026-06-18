import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { invoiceTypeEnum, invoiceStatusEnum, planTypeEnum } from "./enums";

// PRD Bagian 9.1 — platform billing invoices (setup fee / subscription / topup via Midtrans).
export const platformInvoices = pgTable(
  "platform_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: invoiceTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("pending"),
    midtransOrderId: varchar("midtrans_order_id", { length: 255 }),
    midtransPaymentUrl: text("midtrans_payment_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("invoices_user_idx").on(t.userId),
  }),
);

// PRD Bagian 9.1 — pricing config set by admin via CMS.
export const pricingConfig = pgTable("pricing_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  planType: planTypeEnum("plan_type").notNull(),
  setupFee: numeric("setup_fee", { precision: 15, scale: 2 }).notNull().default("0"),
  monthlyFee: numeric("monthly_fee", { precision: 15, scale: 2 }).notNull().default("0"),
  perTransactionFee: numeric("per_transaction_fee", { precision: 15, scale: 2 }).notNull().default("0"),
  maxShops: integer("max_shops"),
  maxOrdersPerMonth: integer("max_orders_per_month"),
  features: jsonb("features").$type<Record<string, boolean>>().default({}),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
