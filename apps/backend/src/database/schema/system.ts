import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
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
