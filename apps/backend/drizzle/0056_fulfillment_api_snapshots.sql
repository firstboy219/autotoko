-- Audit mirror of marketplace fulfillment packages pulled from the API. Separate
-- from local resi/OCR data (never touched). Additive and idempotent.
CREATE TABLE IF NOT EXISTS "fulfillment_api_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  "marketplace" "marketplace" NOT NULL,
  "package_id" varchar(128) NOT NULL,
  "marketplace_order_id" varchar(128),
  "status" varchar(64),
  "tracking_number" varchar(128),
  "shipping_provider" varchar(128),
  "raw" jsonb,
  "updated_at_marketplace" timestamp with time zone,
  "api_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fulfillment_api_snapshots_shop_pkg_unique" UNIQUE("shop_id","package_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fulfillment_api_snapshots" ADD CONSTRAINT "fulfillment_api_snapshots_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_api_snapshots_shop_idx" ON "fulfillment_api_snapshots" USING btree ("shop_id");
