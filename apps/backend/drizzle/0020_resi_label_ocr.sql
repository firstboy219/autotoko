ALTER TABLE "resi_scans" ADD COLUMN "photo_url" varchar(255);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "barcode_format" varchar(32);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "ocr_status" varchar(16) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "ocr_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "ocr_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "ocr_text" text;--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "label_order_no" varchar(128);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "label_recipient" varchar(255);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "label_marketplace" varchar(32);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "label_items" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resi_scans_ocr_status_idx" ON "resi_scans" USING btree ("ocr_status","scanned_at");