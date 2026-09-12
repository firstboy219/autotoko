-- Audit mirror of marketplace orders pulled from the API. Separate from `orders`
-- (local/OCR/webhook baseline) so the audit can compare the two without hitting
-- orders' UNIQUE (marketplace, marketplace_order_id) or overwriting local rows.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "order_api_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  "marketplace" "marketplace" NOT NULL,
  "marketplace_order_id" varchar(128) NOT NULL,
  "status" varchar(64),
  "buyer_name" varchar(255),
  "total_amount" numeric(15, 2),
  "shipping_courier" varchar(128),
  "tracking_number" varchar(128),
  "payment_method" varchar(64),
  "items" jsonb,
  "raw" jsonb,
  "created_at_marketplace" timestamp with time zone,
  "api_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_api_snapshots_shop_order_unique" UNIQUE("shop_id","marketplace_order_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "order_api_snapshots" ADD CONSTRAINT "order_api_snapshots_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_api_snapshots_shop_idx" ON "order_api_snapshots" USING btree ("shop_id");
