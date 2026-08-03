ALTER TYPE "public"."sedekah_basis" ADD VALUE 'both_from_total';--> statement-breakpoint
ALTER TABLE "payout_settings" ADD COLUMN "default_sub_seller_rate" numeric(5, 4) DEFAULT '0.2000' NOT NULL;