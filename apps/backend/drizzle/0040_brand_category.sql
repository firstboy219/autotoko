-- A shop category is a brand, and a brand owns its products and its materials.
--
-- The seller's own words: "kategori itu sebenarnya bisnisnya/brandnya, misal
-- renature untuk kesehatan dan kecantikan, foodfarm untuk makanan". So this is
-- not a display filter bolted onto a list — it is which business a thing
-- belongs to, and the master lists were mixing two businesses into one.
--
-- Deliberately NOT reusing master_products.category_id. That column is an
-- integer marketplace category from the posting flow and carries no foreign
-- key to shop_categories; overloading it would silently tie a brand to whatever
-- Shopee calls a taxonomy node this quarter.

ALTER TABLE master_products
    ADD COLUMN IF NOT EXISTS shop_category_id uuid
    REFERENCES shop_categories(id) ON DELETE SET NULL;

ALTER TABLE materials
    ADD COLUMN IF NOT EXISTS shop_category_id uuid
    REFERENCES shop_categories(id) ON DELETE SET NULL;

-- Null means "not assigned yet", and the lists show those under "tanpa brand"
-- rather than hiding them. A product that vanishes because nobody categorised
-- it is how a filter turns into data loss.
CREATE INDEX IF NOT EXISTS master_products_brand_idx
    ON master_products (user_id, shop_category_id);
CREATE INDEX IF NOT EXISTS materials_brand_idx
    ON materials (user_id, shop_category_id);

-- Seed what can be inferred without guessing.
--
-- Only when a tenant has exactly ONE category does "which brand is this" have
-- an answer that cannot be wrong. With two or more, assigning by anything —
-- name similarity, creation date — would be a guess that looks like a fact, and
-- unpicking it later means knowing which rows were guessed.
SET app.bypass = 'on';

UPDATE master_products p
SET shop_category_id = c.id
FROM (
    SELECT user_id, min(id) AS id, count(*) AS n
    FROM shop_categories GROUP BY user_id
) c
WHERE c.n = 1 AND p.user_id = c.user_id AND p.shop_category_id IS NULL;

UPDATE materials m
SET shop_category_id = c.id
FROM (
    SELECT user_id, min(id) AS id, count(*) AS n
    FROM shop_categories GROUP BY user_id
) c
WHERE c.n = 1 AND m.user_id = c.user_id AND m.shop_category_id IS NULL;

RESET app.bypass;
