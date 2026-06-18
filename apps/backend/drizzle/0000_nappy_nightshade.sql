CREATE TYPE "public"."affiliate_status" AS ENUM('prospect', 'invited', 'active', 'rejected', 'blacklist');--> statement-breakpoint
CREATE TYPE "public"."chat_type" AS ENUM('buyer', 'affiliate');--> statement-breakpoint
CREATE TYPE "public"."health_score" AS ENUM('A', 'B', 'C', 'D');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('setup_fee', 'subscription', 'topup');--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('tiktok', 'shopee', 'tokopedia', 'lazada');--> statement-breakpoint
CREATE TYPE "public"."notif_channel" AS ENUM('wa', 'email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('freemium', 'starter', 'pro');--> statement-breakpoint
CREATE TYPE "public"."posting_status" AS ENUM('active', 'inactive', 'deleted', 'under_review', 'banned');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'inactive', 'draft');--> statement-breakpoint
CREATE TYPE "public"."restock_method" AS ENUM('wa_owner', 'wa_supplier', 'supplier_api');--> statement-breakpoint
CREATE TYPE "public"."shop_status" AS ENUM('active', 'deactivated', 'suspended', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."wa_login_status" AS ENUM('pending', 'verified', 'expired');--> statement-breakpoint
CREATE TYPE "public"."wallet_tx_type" AS ENUM('topup', 'deduct_subscription', 'deduct_transaction', 'deduct_setup', 'refund');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"whatsapp" varchar(32),
	"full_name" varchar(255),
	"plan_type" "plan_type" DEFAULT 'freemium' NOT NULL,
	"plan_started_at" timestamp with time zone,
	"plan_expired_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_whatsapp_unique" UNIQUE("whatsapp")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_login_sessions" (
	"code" varchar(20) PRIMARY KEY NOT NULL,
	"wa_number" varchar(32),
	"status" "wa_login_status" DEFAULT 'pending' NOT NULL,
	"callback_token" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "wa_login_sessions_callback_token_unique" UNIQUE("callback_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"balance_before" numeric(15, 2) NOT NULL,
	"balance_after" numeric(15, 2) NOT NULL,
	"reference_id" varchar(255),
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'IDR' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"shop_id" varchar(128) NOT NULL,
	"shop_name" varchar(255),
	"shop_cipher" varchar(255),
	"open_id" varchar(255),
	"merchant_id" varchar(255),
	"seller_region" varchar(8),
	"access_token" text,
	"access_token_expire_at" timestamp with time zone,
	"refresh_token" text,
	"refresh_token_expire_at" timestamp with time zone,
	"shop_status" "shop_status" DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_product_id" uuid NOT NULL,
	"material_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit" varchar(32),
	"current_stock" numeric(10, 3) DEFAULT '0' NOT NULL,
	"minimum_threshold" numeric(10, 3) DEFAULT '0' NOT NULL,
	"restock_method" "restock_method" DEFAULT 'wa_owner' NOT NULL,
	"supplier_name" varchar(255),
	"supplier_shopee_url" varchar(1000),
	"supplier_wa_number" varchar(32),
	"supplier_api_url" varchar(1000),
	"supplier_api_key" text,
	"restock_qty" numeric(10, 3),
	"restock_price" numeric(15, 2),
	"payment_method" varchar(32),
	"shipping_address" text,
	"receiver_name" varchar(255),
	"receiver_phone" varchar(32),
	"notes_for_supplier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_product_id" uuid NOT NULL,
	"sku" varchar(128) NOT NULL,
	"variant_name" varchar(255),
	"price" numeric(15, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sku" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category_id" integer,
	"base_price" numeric(15, 2),
	"weight_gram" integer,
	"images" jsonb DEFAULT '[]'::jsonb,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"health_score" "health_score",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_products_user_sku_unique" UNIQUE("user_id","sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_product_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"marketplace_item_id" varchar(128),
	"marketplace_sku" varchar(128),
	"title" varchar(500),
	"price" numeric(15, 2),
	"stock" integer,
	"status" "posting_status" DEFAULT 'active' NOT NULL,
	"views_7d" integer DEFAULT 0 NOT NULL,
	"sold_7d" integer DEFAULT 0 NOT NULL,
	"gmv_7d" numeric(15, 2) DEFAULT '0' NOT NULL,
	"review_score" numeric(3, 2),
	"review_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"marketplace_order_id" varchar(128) NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"status" varchar(64),
	"buyer_name" varchar(255),
	"buyer_phone" varchar(32),
	"shipping_address" jsonb,
	"shipping_courier" varchar(128),
	"tracking_number" varchar(128),
	"payment_method" varchar(64),
	"subtotal" numeric(15, 2),
	"shipping_fee" numeric(15, 2),
	"marketplace_fee" numeric(15, 2),
	"total_amount" numeric(15, 2),
	"platform_fee" numeric(15, 2),
	"fee_deducted" boolean DEFAULT false NOT NULL,
	"awb_generated" boolean DEFAULT false NOT NULL,
	"label_printed" boolean DEFAULT false NOT NULL,
	"items" jsonb,
	"created_at_marketplace" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_mp_order_unique" UNIQUE("marketplace","marketplace_order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"event_type" varchar(128),
	"event_id" varchar(255) NOT NULL,
	"shop_id" uuid,
	"payload" jsonb,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_mp_event_unique" UNIQUE("marketplace","event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "invoice_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"midtrans_order_id" varchar(255),
	"midtrans_payment_url" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_type" "plan_type" NOT NULL,
	"setup_fee" numeric(15, 2) DEFAULT '0' NOT NULL,
	"monthly_fee" numeric(15, 2) DEFAULT '0' NOT NULL,
	"per_transaction_fee" numeric(15, 2) DEFAULT '0' NOT NULL,
	"max_shops" integer,
	"max_orders_per_month" integer,
	"features" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"creator_id" varchar(128),
	"creator_name" varchar(255),
	"follower_count" integer,
	"niche" varchar(128),
	"status" "affiliate_status" DEFAULT 'prospect' NOT NULL,
	"commission_rate" numeric(5, 2),
	"total_gmv" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid,
	"chat_type" "chat_type" NOT NULL,
	"counterpart_id" varchar(128),
	"counterpart_name" varchar(255),
	"message_in" text,
	"message_out" text,
	"ai_model" varchar(128),
	"tokens_used" integer,
	"marketplace_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid,
	"marketplace_review_id" varchar(128),
	"rating" integer,
	"review_text" text,
	"reply_text" text,
	"ai_generated" boolean DEFAULT true NOT NULL,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text,
	"description" varchar(500),
	"updated_by" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(128),
	"title" varchar(255),
	"message" text,
	"channel" "notif_channel" DEFAULT 'email' NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shops" ADD CONSTRAINT "shops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_master_product_id_master_products_id_fk" FOREIGN KEY ("master_product_id") REFERENCES "public"."master_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_product_variants" ADD CONSTRAINT "master_product_variants_master_product_id_master_products_id_fk" FOREIGN KEY ("master_product_id") REFERENCES "public"."master_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_products" ADD CONSTRAINT "master_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_postings" ADD CONSTRAINT "product_postings_master_product_id_master_products_id_fk" FOREIGN KEY ("master_product_id") REFERENCES "public"."master_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_postings" ADD CONSTRAINT "product_postings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_logs" ADD CONSTRAINT "chat_logs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_logs" ADD CONSTRAINT "chat_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_user_idx" ON "shops" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_mp_shop_idx" ON "shops" USING btree ("marketplace","shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_products_user_idx" ON "master_products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "postings_master_idx" ON "product_postings" USING btree ("master_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "postings_shop_idx" ON "product_postings" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "postings_mp_sku_idx" ON "product_postings" USING btree ("marketplace_sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_shop_idx" ON "orders" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_user_idx" ON "platform_invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliates_user_idx" ON "affiliates" USING btree ("user_id");