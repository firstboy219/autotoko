CREATE TYPE "public"."payout_batch_status" AS ENUM('running', 'awaiting_transfer', 'transferred', 'completed');--> statement-breakpoint
CREATE TYPE "public"."payout_forward_status" AS ENUM('pending', 'forwarded');--> statement-breakpoint
CREATE TYPE "public"."payout_mutation_status" AS ENUM('draft', 'completed');--> statement-breakpoint
CREATE TYPE "public"."sedekah_basis" AS ENUM('total_credit', 'after_subseller_split');--> statement-breakpoint
CREATE TYPE "public"."sub_seller_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mutation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"status" "payout_batch_status" DEFAULT 'running' NOT NULL,
	"closed_at" timestamp with time zone,
	"total_transfer_to_admin" numeric(15, 2) DEFAULT '0' NOT NULL,
	"transfer_proof_url" text,
	"transferred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"payout_date" date NOT NULL,
	"marketplace_proof_amount" numeric(15, 2),
	"credit_amount" numeric(15, 2) NOT NULL,
	"receiving_account" varchar(255),
	"marketplace_proof_url" text,
	"sedekah_rate_used" numeric(5, 4) NOT NULL,
	"sedekah_basis_used" "sedekah_basis" NOT NULL,
	"sub_seller_rate_used" numeric(5, 4),
	"sub_sub_seller_rate_used" numeric(5, 4),
	"sub_seller_id" uuid,
	"sub_sub_seller_id" uuid,
	"sedekah_amount" numeric(15, 2) NOT NULL,
	"seller_amount" numeric(15, 2) NOT NULL,
	"sub_seller_amount" numeric(15, 2),
	"sub_sub_seller_amount" numeric(15, 2),
	"sedekah_transfer_proof_url" text,
	"seller_transfer_proof_url" text,
	"sub_seller_transfer_proof_url" text,
	"sub_sub_seller_transfer_proof_url" text,
	"order_ref_ids" jsonb,
	"status" "payout_mutation_status" DEFAULT 'draft' NOT NULL,
	"sub_seller_forward_status" "payout_forward_status",
	"sub_sub_seller_forward_status" "payout_forward_status",
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sedekah_rate" numeric(5, 4) DEFAULT '0.0500' NOT NULL,
	"sedekah_basis" "sedekah_basis" DEFAULT 'total_credit' NOT NULL,
	"sedekah_bank_account" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sub_sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact" varchar(64),
	"login_email" varchar(255),
	"bank_account" varchar(255),
	"default_rate" numeric(5, 4) DEFAULT '0.2000' NOT NULL,
	"status" "sub_seller_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sub_sub_sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_seller_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact" varchar(64),
	"login_email" varchar(255),
	"bank_account" varchar(255),
	"default_rate" numeric(5, 4) DEFAULT '0.5000' NOT NULL,
	"status" "sub_seller_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "sub_seller_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "sub_sub_seller_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rate_override_sub_seller" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rate_override_sub_sub_seller" numeric(5, 4);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_mutation_id_payout_mutations_id_fk" FOREIGN KEY ("mutation_id") REFERENCES "public"."payout_mutations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_mutations" ADD CONSTRAINT "payout_mutations_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_mutations" ADD CONSTRAINT "payout_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_mutations" ADD CONSTRAINT "payout_mutations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_mutations" ADD CONSTRAINT "payout_mutations_sub_seller_id_sub_sellers_id_fk" FOREIGN KEY ("sub_seller_id") REFERENCES "public"."sub_sellers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_mutations" ADD CONSTRAINT "payout_mutations_sub_sub_seller_id_sub_sub_sellers_id_fk" FOREIGN KEY ("sub_sub_seller_id") REFERENCES "public"."sub_sub_sellers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_mutations" ADD CONSTRAINT "payout_mutations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_settings" ADD CONSTRAINT "payout_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sub_sellers" ADD CONSTRAINT "sub_sellers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sub_sub_sellers" ADD CONSTRAINT "sub_sub_sellers_sub_seller_id_sub_sellers_id_fk" FOREIGN KEY ("sub_seller_id") REFERENCES "public"."sub_sellers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sub_sub_sellers" ADD CONSTRAINT "sub_sub_sellers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_adjustments_mutation_idx" ON "payout_adjustments" USING btree ("mutation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_batches_user_status_idx" ON "payout_batches" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_mutations_batch_idx" ON "payout_mutations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_mutations_user_date_idx" ON "payout_mutations" USING btree ("user_id","payout_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_mutations_shop_idx" ON "payout_mutations" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_sellers_user_idx" ON "sub_sellers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_sub_sellers_parent_idx" ON "sub_sub_sellers" USING btree ("sub_seller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_sub_sellers_user_idx" ON "sub_sub_sellers" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shops" ADD CONSTRAINT "shops_sub_seller_id_sub_sellers_id_fk" FOREIGN KEY ("sub_seller_id") REFERENCES "public"."sub_sellers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shops" ADD CONSTRAINT "shops_sub_sub_seller_id_sub_sub_sellers_id_fk" FOREIGN KEY ("sub_sub_seller_id") REFERENCES "public"."sub_sub_sellers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_sub_seller_idx" ON "shops" USING btree ("sub_seller_id");