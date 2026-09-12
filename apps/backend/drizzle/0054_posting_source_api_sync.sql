-- Marketplace API product sync: mark the origin of each product_postings row and
-- let API-pulled rows arrive unlinked (pending review) without touching the
-- hand-entered audit baseline.
--
-- Additive and idempotent. Existing rows become source='manual' automatically
-- (that IS the audit baseline). API rows are written as source='api' and never
-- overwrite manual rows. master_product_id becomes nullable so an API row can
-- sit in the review queue until a user merges it onto a master.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'posting_source') THEN
    CREATE TYPE "public"."posting_source" AS ENUM('manual', 'api');
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "product_postings" ADD COLUMN IF NOT EXISTS "source" "posting_source" DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_postings" ADD COLUMN IF NOT EXISTS "raw" jsonb;
--> statement-breakpoint
ALTER TABLE "product_postings" ADD COLUMN IF NOT EXISTS "api_synced_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "product_postings" ALTER COLUMN "master_product_id" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "postings_shop_item_idx" ON "product_postings" USING btree ("shop_id","marketplace_item_id");
