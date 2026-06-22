import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";
import { marketplaceEnum, fulfillmentStatusEnum } from "./enums";

// PRD Bagian 9.1 — ORDERS.
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    marketplaceOrderId: varchar("marketplace_order_id", { length: 128 }).notNull(),
    marketplace: marketplaceEnum("marketplace").notNull(),
    status: varchar("status", { length: 64 }), // UNPAID, AWAITING_SHIPMENT, ...
    fulfillmentStatus: fulfillmentStatusEnum("fulfillment_status").notNull().default("masuk"),
    buyerName: varchar("buyer_name", { length: 255 }),
    buyerPhone: varchar("buyer_phone", { length: 32 }),
    shippingAddress: jsonb("shipping_address"),
    shippingCourier: varchar("shipping_courier", { length: 128 }),
    trackingNumber: varchar("tracking_number", { length: 128 }),
    paymentMethod: varchar("payment_method", { length: 64 }),
    subtotal: numeric("subtotal", { precision: 15, scale: 2 }),
    shippingFee: numeric("shipping_fee", { precision: 15, scale: 2 }),
    marketplaceFee: numeric("marketplace_fee", { precision: 15, scale: 2 }),
    totalAmount: numeric("total_amount", { precision: 15, scale: 2 }),
    platformFee: numeric("platform_fee", { precision: 15, scale: 2 }), // fee we charge
    feeDeducted: boolean("fee_deducted").notNull().default(false),
    awbGenerated: boolean("awb_generated").notNull().default(false),
    labelPrinted: boolean("label_printed").notNull().default(false),
    items: jsonb("items"),
    createdAtMarketplace: timestamp("created_at_marketplace", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mpOrderUnique: unique("orders_mp_order_unique").on(t.marketplace, t.marketplaceOrderId),
    userIdx: index("orders_user_idx").on(t.userId),
    shopIdx: index("orders_shop_idx").on(t.shopId),
  }),
);

// PRD Bagian 9.1 — webhook idempotency (marketplaces may send the same event >1x).
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceEnum("marketplace").notNull(),
    eventType: varchar("event_type", { length: 128 }),
    eventId: varchar("event_id", { length: 255 }).notNull(), // unique id from marketplace
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    payload: jsonb("payload"),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventUnique: unique("webhook_events_mp_event_unique").on(t.marketplace, t.eventId),
  }),
);
