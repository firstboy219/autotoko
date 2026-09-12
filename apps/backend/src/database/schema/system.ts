import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { notifChannelEnum } from "./enums";

// PRD Bagian 9.1 — notifications (outgoing channel = email per PRD 3.3).
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 128 }),
  title: varchar("title", { length: 255 }),
  message: text("message"),
  channel: notifChannelEnum("channel").notNull().default("email"),
  sent: boolean("sent").notNull().default(false),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PRD Bagian 7 / 18 — admin settings: credentials, branding, AI provider/model.
// Values are encrypted at rest (app layer); keys are namespaced (e.g. brand_*,
// tiktok_app_key, ai_provider, ai_model).
export const adminSettings = pgTable("admin_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"), // encrypted
  description: varchar("description", { length: 500 }),
  updatedBy: varchar("updated_by", { length: 128 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Audit feed for AI autopilot actions (PRD Bagian 8). Every automatic decision
 * the platform makes on the seller's behalf is recorded here so a human can
 * monitor the "full-auto" activity (owner requirement: setup is manual, running
 * activity stays observable). `status`: done | held | error.
 */
export const autopilotActivity = pgTable(
  "autopilot_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: varchar("feature", { length: 64 }).notNull(), // ai feature key
    action: varchar("action", { length: 64 }).notNull(), // e.g. auto_approve
    status: varchar("status", { length: 16 }).notNull(), // done | held | error
    provider: varchar("provider", { length: 32 }), // ai provider used
    summary: text("summary"), // human-readable reason/result
    refType: varchar("ref_type", { length: 32 }), // e.g. order
    refId: uuid("ref_id"), // related entity id (order id, ...)
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("autopilot_activity_user_idx").on(t.userId),
  }),
);
