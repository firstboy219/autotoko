CREATE TABLE IF NOT EXISTS "resi_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resi" varchar(64) NOT NULL,
	"resi_raw" varchar(128),
	"courier" varchar(32),
	"order_id" uuid,
	"source" varchar(16) DEFAULT 'ocr' NOT NULL,
	"device_label" varchar(64),
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resi_scans_user_resi_unique" UNIQUE("user_id","resi")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resi_scans" ADD CONSTRAINT "resi_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resi_scans" ADD CONSTRAINT "resi_scans_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resi_scans_user_scanned_idx" ON "resi_scans" USING btree ("user_id","scanned_at");