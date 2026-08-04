ALTER TABLE "resi_scans" ADD COLUMN "tracking_status" varchar(120);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "tracking_category" varchar(24);--> statement-breakpoint
ALTER TABLE "resi_scans" ADD COLUMN "tracking_checked_at" timestamp with time zone;