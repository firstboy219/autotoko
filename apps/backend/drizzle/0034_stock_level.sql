-- A stock reading somebody can actually give from the shelf.
--
-- current_stock is a number, and a number is only as good as the counting
-- behind it: nobody weighs the glycerine before packing. What a packer CAN say
-- while standing in front of the rack is which of five buckets it is in, and
-- that is enough to decide whether to order today, this week, or not at all.
--
-- Kept beside current_stock rather than replacing it. They answer different
-- questions — what the books say versus what the shelf looks like — and the
-- disagreement between them is itself worth seeing.
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "stock_level" varchar(16);
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "stock_level_at" timestamp with time zone;
