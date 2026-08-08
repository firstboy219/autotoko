-- Raw materials reported as they arrive at the packing room.
--
-- Recorded as a purchase, because that is what it is: stock coming in against
-- a document. Giving deliveries their own table would mean two mechanisms for
-- adding stock, and the second one would drift.
--
-- What is different is that the person at the door does not know what anything
-- cost. That distinction has to survive into the data: a line with NO cost
-- must leave the weighted average alone, while a line costing zero really is
-- free. Nullable total_cost is what separates them.

-- The waybill on the parcel that arrived.
ALTER TABLE "material_purchases" ADD COLUMN IF NOT EXISTS "resi" varchar(64);
-- manual | delivery_scan — how this record came to exist.
ALTER TABLE "material_purchases" ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'manual';

-- The same parcel must not be able to add its contents to stock twice. Partial,
-- so the rows without a waybill (every purchase typed in by hand) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "material_purchases_user_resi_unique"
  ON "material_purchases" ("user_id", "resi") WHERE "resi" IS NOT NULL;

-- How the quantity was arrived at.
--
-- A delivery is counted in packages — "3 bottles" — while the catalogue holds
-- millilitres, because that is what a recipe consumes. Keeping both halves
-- means the arithmetic can be checked later, and a mis-typed content size can
-- be found instead of only its wrong total.
ALTER TABLE "material_purchase_items" ADD COLUMN IF NOT EXISTS "qty_pcs" numeric(14,3);
ALTER TABLE "material_purchase_items" ADD COLUMN IF NOT EXISTS "content_per_pcs" numeric(14,3);

-- Paid to the courier at the door, and how much.
--
-- The amount belongs to the PARCEL, not to any material in it. Splitting it
-- across several materials would need a rule nobody has — by weight? by count?
-- — and a wrong split does not fail loudly, it silently mis-states the HPP of
-- everything built from them. So it is recorded here and only pushed down to a
-- line when there is exactly one, where it is not a guess at all.
ALTER TABLE "material_purchases" ADD COLUMN IF NOT EXISTS "is_cod" boolean NOT NULL DEFAULT false;
ALTER TABLE "material_purchases" ADD COLUMN IF NOT EXISTS "cod_amount" numeric(15,2);

-- Null now means "nobody said", which is not the same as free. Existing rows
-- keep their zeros: those were recorded by a form that always sent a figure.
ALTER TABLE "material_purchase_items" ALTER COLUMN "total_cost" DROP NOT NULL;
ALTER TABLE "material_purchase_items" ALTER COLUMN "unit_cost" DROP NOT NULL;
