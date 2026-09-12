CREATE TABLE IF NOT EXISTS "material_purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"total_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"created_material" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purchased_at" date NOT NULL,
	"supplier_name" varchar(255),
	"note" text,
	"receipt_url" text,
	"ocr_raw_result" jsonb,
	"total_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"normalized_name" varchar(255) NOT NULL,
	"unit" varchar(32),
	"current_stock" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"minimum_threshold" numeric(14, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_user_normalized_unique" UNIQUE("user_id","normalized_name")
);
--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "material_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_purchase_items" ADD CONSTRAINT "material_purchase_items_purchase_id_material_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."material_purchases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_purchase_items" ADD CONSTRAINT "material_purchase_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_purchase_items" ADD CONSTRAINT "material_purchase_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_purchases" ADD CONSTRAINT "material_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "materials" ADD CONSTRAINT "materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_purchase_items_purchase_idx" ON "material_purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_purchase_items_material_idx" ON "material_purchase_items" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_purchases_user_idx" ON "material_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "materials_user_idx" ON "materials" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Backfill the catalog from existing recipe rows.
-- Duplicated names (e.g. "Tabung" used by two products) collapse into ONE
-- material. Stock/cost take the MAX across the duplicates rather than the SUM:
-- the rows were two views of the same physical material, so summing would
-- invent stock that never existed.
INSERT INTO "materials" ("user_id", "name", "normalized_name", "unit", "current_stock", "unit_cost", "minimum_threshold")
SELECT
  m."user_id",
  MIN(b."material_name") AS name,
  lower(regexp_replace(btrim(b."material_name"), '\s+', ' ', 'g')) AS normalized_name,
  MIN(b."unit") AS unit,
  MAX(b."current_stock") AS current_stock,
  MAX(b."unit_cost") AS unit_cost,
  MAX(b."minimum_threshold") AS minimum_threshold
FROM "bom_items" b
JOIN "master_products" m ON m."id" = b."master_product_id"
GROUP BY m."user_id", lower(regexp_replace(btrim(b."material_name"), '\s+', ' ', 'g'))
ON CONFLICT ("user_id", "normalized_name") DO NOTHING;
--> statement-breakpoint
-- Point every recipe line at its catalog entry.
UPDATE "bom_items" b
SET "material_id" = mat."id"
FROM "master_products" p, "materials" mat
WHERE p."id" = b."master_product_id"
  AND mat."user_id" = p."user_id"
  AND mat."normalized_name" = lower(regexp_replace(btrim(b."material_name"), '\s+', ' ', 'g'))
  AND b."material_id" IS NULL;
