CREATE TABLE IF NOT EXISTS "packing_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"fee_per_resi" numeric(15, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "packer_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "packer_paid_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "packer_note" varchar(120);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "packing_settings" ADD CONSTRAINT "packing_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resi_scans_packer_paid_idx" ON "resi_scans" USING btree ("user_id","packer_paid_at");