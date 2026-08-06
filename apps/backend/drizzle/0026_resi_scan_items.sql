CREATE TABLE IF NOT EXISTS "resi_scan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resi_scan_id" uuid NOT NULL,
	"master_product_id" uuid,
	"raw_name" varchar(255),
	"raw_qty" numeric(10, 2),
	"qty" numeric(10, 2) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resi_scan_items" ADD CONSTRAINT "resi_scan_items_resi_scan_id_resi_scans_id_fk" FOREIGN KEY ("resi_scan_id") REFERENCES "public"."resi_scans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resi_scan_items" ADD CONSTRAINT "resi_scan_items_master_product_id_master_products_id_fk" FOREIGN KEY ("master_product_id") REFERENCES "public"."master_products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resi_scan_items_scan_idx" ON "resi_scan_items" USING btree ("resi_scan_id");