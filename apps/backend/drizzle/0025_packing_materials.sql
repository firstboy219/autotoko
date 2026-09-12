CREATE TABLE IF NOT EXISTS "packing_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"default_quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_materials_user_material_unique" UNIQUE("user_id","material_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_packing_quantities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_product_id" uuid NOT NULL,
	"packing_material_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "product_packing_qty_unique" UNIQUE("master_product_id","packing_material_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "packing_materials" ADD CONSTRAINT "packing_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "packing_materials" ADD CONSTRAINT "packing_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_packing_quantities" ADD CONSTRAINT "product_packing_quantities_master_product_id_master_products_id_fk" FOREIGN KEY ("master_product_id") REFERENCES "public"."master_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_packing_quantities" ADD CONSTRAINT "product_packing_quantities_packing_material_id_packing_materials_id_fk" FOREIGN KEY ("packing_material_id") REFERENCES "public"."packing_materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packing_materials_user_idx" ON "packing_materials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_packing_qty_product_idx" ON "product_packing_quantities" USING btree ("master_product_id");