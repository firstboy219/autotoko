ALTER TABLE "payout_mutations" ADD COLUMN "seller_material_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_mutations" ADD COLUMN "material_reserve_rate_used" numeric(5, 4) DEFAULT '0.0000' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_settings" ADD COLUMN "material_reserve_rate" numeric(5, 4) DEFAULT '0.0000' NOT NULL;