-- When a material's price last changed, and one catalogue for every recipe line.

-- updated_at moves for a rename or a stock count too, so it cannot answer
-- "when was this price set?". A seller deciding whether a HPP is still current
-- needs the price's own date.
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "unit_cost_updated_at" timestamp with time zone;

-- Best available answer for prices set before this column existed. Left null
-- where the price is still zero: never-set is not the same as set-long-ago.
UPDATE "materials"
   SET "unit_cost_updated_at" = "updated_at"
 WHERE "unit_cost_updated_at" IS NULL AND "unit_cost" > 0;

-- ---------------------------------------------------------------------------
-- Every recipe line joins the catalogue.
--
-- 8 of 39 lines carried no material_id, because the old BOM form inserted a
-- name and a price straight onto the line. Those lines cost from their own
-- private copy, so changing the price in the catalogue reached every other
-- product and silently skipped them -- which is exactly the complaint that
-- prompted this. One source of truth is the fix; the copy on the line stays
-- only so anything reading the table directly does not see two prices.
--
-- Verified before running: no product has an unlinked line whose name matches
-- a material it is ALREADY linked to, so linking cannot double an ingredient.

-- Names with no catalogue entry get one, priced from the line. max() rather
-- than any(): where two lines spell the same material differently, the higher
-- price is the safer default, since understating HPP overstates margin.
INSERT INTO "materials" (user_id, name, normalized_name, unit, unit_cost, current_stock, minimum_threshold)
SELECT mp.user_id,
       min(b.material_name),
       lower(regexp_replace(btrim(b.material_name), '\s+', ' ', 'g')),
       min(b.unit),
       max(b.unit_cost),
       0,
       0
  FROM "bom_items" b
  JOIN "master_products" mp ON mp.id = b.master_product_id
 WHERE b.material_id IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM "materials" m
          WHERE m.user_id = mp.user_id
            AND m.normalized_name = lower(regexp_replace(btrim(b.material_name), '\s+', ' ', 'g'))
       )
 GROUP BY mp.user_id, lower(regexp_replace(btrim(b.material_name), '\s+', ' ', 'g'))
ON CONFLICT DO NOTHING;

UPDATE "bom_items" b
   SET material_id = m.id
  FROM "master_products" mp, "materials" m
 WHERE b.master_product_id = mp.id
   AND b.material_id IS NULL
   AND m.user_id = mp.user_id
   AND m.normalized_name = lower(regexp_replace(btrim(b.material_name), '\s+', ' ', 'g'))
   AND NOT EXISTS (
         SELECT 1 FROM "bom_items" x
          WHERE x.master_product_id = b.master_product_id AND x.material_id = m.id
       );

-- The line's own copy of the price is now decoration. Bring the stale ones
-- into step so the table cannot be read two ways.
UPDATE "bom_items" b
   SET unit_cost = m.unit_cost
  FROM "materials" m
 WHERE b.material_id = m.id AND b.unit_cost <> m.unit_cost;
