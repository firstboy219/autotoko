CREATE TYPE "public"."payout_disbursement_recipient_type" AS ENUM('sedekah', 'sub_seller', 'sub_sub_seller');--> statement-breakpoint
CREATE TYPE "public"."payout_disbursement_validation_status" AS ENUM('belum_upload', 'cocok_otomatis', 'override_manual');--> statement-breakpoint
CREATE TYPE "public"."shop_added_by_type" AS ENUM('seller', 'sub_seller', 'sub_sub_seller');--> statement-breakpoint
ALTER TYPE "public"."payout_batch_status" ADD VALUE 'berjalan';--> statement-breakpoint
ALTER TYPE "public"."payout_batch_status" ADD VALUE 'siap_distribusi';--> statement-breakpoint
ALTER TYPE "public"."payout_batch_status" ADD VALUE 'selesai';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_mutation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recipient_type" "payout_disbursement_recipient_type" NOT NULL,
	"recipient_sub_seller_id" uuid,
	"recipient_sub_sub_seller_id" uuid,
	"expected_amount" numeric(15, 2) NOT NULL,
	"recorded_account" varchar(255),
	"proof_url" text,
	"ocr_amount" numeric(15, 2),
	"ocr_account" varchar(255),
	"ocr_raw_result" jsonb,
	"validation_status" "payout_disbursement_validation_status" DEFAULT 'belum_upload' NOT NULL,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_batches" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "added_by_type" "shop_added_by_type" DEFAULT 'seller' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "added_by_id" uuid;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_mutations" ADD COLUMN "ocr_raw_result" jsonb;--> statement-breakpoint
ALTER TABLE "sub_sellers" ADD COLUMN "kuota_toko_maksimal" integer;--> statement-breakpoint
ALTER TABLE "sub_sub_sellers" ADD COLUMN "kuota_toko_maksimal" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_disbursements" ADD CONSTRAINT "payout_disbursements_payout_mutation_id_payout_mutations_id_fk" FOREIGN KEY ("payout_mutation_id") REFERENCES "public"."payout_mutations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_disbursements" ADD CONSTRAINT "payout_disbursements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_disbursements" ADD CONSTRAINT "payout_disbursements_recipient_sub_seller_id_sub_sellers_id_fk" FOREIGN KEY ("recipient_sub_seller_id") REFERENCES "public"."sub_sellers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_disbursements" ADD CONSTRAINT "payout_disbursements_recipient_sub_sub_seller_id_sub_sub_sellers_id_fk" FOREIGN KEY ("recipient_sub_sub_seller_id") REFERENCES "public"."sub_sub_sellers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_disbursements_mutation_idx" ON "payout_disbursements" USING btree ("payout_mutation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_disbursements_user_idx" ON "payout_disbursements" USING btree ("user_id");