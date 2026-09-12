CREATE TABLE IF NOT EXISTS "product_costing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"service_cost_per_pcs" numeric(15, 2) DEFAULT '0' NOT NULL,
	"publish_price" numeric(15, 2),
	"marketplace_fee_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"event_rate" numeric(5, 4) DEFAULT '0.0500' NOT NULL,
	"affiliator_rate" numeric(5, 4) DEFAULT '0.0500' NOT NULL,
	"ads_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"ads_fixed_per_pcs" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sedekah_rate" numeric(5, 4) DEFAULT '0.0500' NOT NULL,
	"reseller_rate" numeric(5, 4) DEFAULT '0.2000' NOT NULL,
	"target_profit_rate" numeric(5, 4) DEFAULT '0.2000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_costing_master_product_id_unique" UNIQUE("master_product_id")
);
--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "unit_cost" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_costing" ADD CONSTRAINT "product_costing_master_product_id_master_products_id_fk" FOREIGN KEY ("master_product_id") REFERENCES "public"."master_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_costing" ADD CONSTRAINT "product_costing_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_costing_user_idx" ON "product_costing" USING btree ("user_id");