-- The material reserve becomes a transfer with proof, like sedekah.
--
-- It was already computed and already set aside out of the seller's own cut,
-- but nothing asked for evidence that the money actually moved. Sedekah has
-- had that from the start: one consolidated transfer per batch, a proof photo,
-- and OCR checking the amount against what was expected. The reserve now gets
-- the same treatment, because "budgeted" and "transferred" are different
-- claims and only one of them can be checked.
--
-- ADD VALUE is not run inside a transaction that also USES the value: Postgres
-- refuses to see a brand-new label from the transaction that created it, which
-- is the same reason payout_batches.status carries no DB default.
ALTER TYPE "payout_disbursement_recipient_type" ADD VALUE IF NOT EXISTS 'bahan_baku';

-- Where the reserve is transferred to. Separate from the sedekah account for
-- the obvious reason that they are different pots of money, and null is fine —
-- the transfer and its proof still work, the row just cannot say which account
-- it was expecting.
ALTER TABLE "payout_settings" ADD COLUMN IF NOT EXISTS "material_bank_account" varchar(255);
