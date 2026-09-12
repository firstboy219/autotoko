ALTER TABLE "payout_disbursements" ALTER COLUMN "payout_mutation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_disbursements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_disbursements" ADD CONSTRAINT "payout_disbursements_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_disbursements_batch_idx" ON "payout_disbursements" USING btree ("batch_id");