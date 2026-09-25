import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { shops } from "./shops.js";

/**
 * Chat pelanggan (Fase 1). Percakapan & pesan dari IM marketplace (mulai
 * TikTok). Tabel ini terisi oleh sinkronisasi IM + webhook (dorman sampai
 * scope IM aktif); UI membaca dari sini. RLS per user_id seperti tabel tenant
 * lain (lihat rls/enable-rls.sql + migrasi 0062).
 */
export const marketplaceConversations = pgTable(
  "marketplace_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    marketplace: varchar("marketplace", { length: 32 }).notNull().default("tiktok"),
    /** ID percakapan sebagaimana diberi marketplace. */
    conversationId: varchar("conversation_id", { length: 128 }).notNull(),
    buyerName: varchar("buyer_name", { length: 255 }),
    lastMessage: text("last_message"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    unread: integer("unread").notNull().default(0),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unik: uniqueIndex("marketplace_conversations_unik").on(t.userId, t.marketplace, t.conversationId),
    userIdx: index("marketplace_conversations_user_idx").on(t.userId),
  }),
);

export const marketplaceMessages = pgTable(
  "marketplace_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => marketplaceConversations.id, { onDelete: "cascade" }),
    /** ID pesan di marketplace (untuk pesan masuk); null untuk yang masih di-antre. */
    marketplaceMessageId: varchar("marketplace_message_id", { length: 128 }),
    /** 'in' (dari pembeli) | 'out' (dari seller). */
    direction: varchar("direction", { length: 16 }).notNull(),
    /** 'buyer' | 'seller' | 'system'. */
    sender: varchar("sender", { length: 16 }),
    text: text("text"),
    /** out: queued|sent|failed ; in: received. */
    status: varchar("status", { length: 16 }).notNull().default("sent"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index("marketplace_messages_conv_idx").on(t.conversationId, t.createdAt),
    userIdx: index("marketplace_messages_user_idx").on(t.userId),
  }),
);

/**
 * Otomasi chat per seller (migrasi 0081). Default balas otomatis MATI.
 * `autoReplyShopIds` null = semua toko; isi untuk membatasi (mis. uji 1 toko).
 */
export const chatSettings = pgTable("chat_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  autoReply: boolean("auto_reply").notNull().default(false),
  autoReplyShopIds: jsonb("auto_reply_shop_ids").$type<string[] | null>(),
  officeStart: smallint("office_start"),
  officeEnd: smallint("office_end"),
  fallbackText: text("fallback_text"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
