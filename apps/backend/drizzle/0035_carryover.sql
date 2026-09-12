-- Commission too small to send, held until it is worth a transfer.
--
-- Banks will not move less than ten thousand rupiah, and 4 of this tenant's 17
-- commission transfers came out below it. Consolidating a person's shops into
-- one transfer helps but does not fix it: three of those four were batches
-- where the sub-seller had only one shop pay out at all.
--
-- So the remainder waits. Held against the PERSON rather than the shop,
-- because that is who the bank transfer goes to and because a shop that pays
-- out once would otherwise leave its small change stranded forever.
CREATE TABLE IF NOT EXISTS "payout_carryovers" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "recipient_type"              payout_disbursement_recipient_type NOT NULL,
  "recipient_sub_seller_id"     uuid REFERENCES "sub_sellers"("id") ON DELETE CASCADE,
  "recipient_sub_sub_seller_id" uuid REFERENCES "sub_sub_sellers"("id") ON DELETE CASCADE,
  "amount"                      numeric(15,2) NOT NULL,
  -- The batch that produced it. Deleting that batch takes the held amount with
  -- it: the payouts it came from no longer exist, so neither does the debt.
  "source_batch_id"             uuid NOT NULL REFERENCES "payout_batches"("id") ON DELETE CASCADE,
  -- The batch that finally paid it out. Null while still waiting.
  "applied_batch_id"            uuid REFERENCES "payout_batches"("id") ON DELETE SET NULL,
  "applied_at"                  timestamp with time zone,
  "created_at"                  timestamp with time zone NOT NULL DEFAULT now()
);

-- The only query that matters: what is still owed to whom.
CREATE INDEX IF NOT EXISTS "payout_carryovers_outstanding_idx"
  ON "payout_carryovers" ("user_id", "applied_at");

-- How much of a transfer came from earlier batches, so a figure that does not
-- match this batch's own commission can explain itself.
ALTER TABLE "payout_disbursements"
  ADD COLUMN IF NOT EXISTS "carryover_amount" numeric(15,2) NOT NULL DEFAULT 0;

-- Below this, a transfer is not created. Configurable because e-wallets and
-- banks disagree, and 10.000 is only the common case.
ALTER TABLE "payout_settings"
  ADD COLUMN IF NOT EXISTS "min_transfer_amount" numeric(15,2) NOT NULL DEFAULT 10000;
