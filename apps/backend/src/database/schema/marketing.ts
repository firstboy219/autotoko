import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { shops } from "./shops";
import { users } from "./users";
import { orders } from "./orders";
import { marketplaceEnum, affiliateStatusEnum, chatTypeEnum } from "./enums";

// PRD Bagian 8.12 / 9.1 — affiliate management.
export const affiliates = pgTable(
  "affiliates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marketplace: marketplaceEnum("marketplace").notNull(),
    creatorId: varchar("creator_id", { length: 128 }),
    creatorName: varchar("creator_name", { length: 255 }),
    followerCount: integer("follower_count"),
    niche: varchar("niche", { length: 128 }),
    status: affiliateStatusEnum("status").notNull().default("prospect"),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }),
    totalGmv: numeric("total_gmv", { precision: 15, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("affiliates_user_idx").on(t.userId),
  }),
);

// PRD Bagian 8.2 / 8.12 — AI conversation logs (buyer & affiliate).
export const chatLogs = pgTable("chat_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  chatType: chatTypeEnum("chat_type").notNull(),
  counterpartId: varchar("counterpart_id", { length: 128 }),
  counterpartName: varchar("counterpart_name", { length: 255 }),
  messageIn: text("message_in"),
  messageOut: text("message_out"),
  aiModel: varchar("ai_model", { length: 128 }),
  tokensUsed: integer("tokens_used"),
  marketplaceSent: boolean("marketplace_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PRD Bagian 8.10 — review reply logs.
export const reviewLogs = pgTable("review_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  marketplaceReviewId: varchar("marketplace_review_id", { length: 128 }),
  rating: integer("rating"), // 1-5
  reviewText: text("review_text"),
  replyText: text("reply_text"),
  aiGenerated: boolean("ai_generated").notNull().default(true),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
