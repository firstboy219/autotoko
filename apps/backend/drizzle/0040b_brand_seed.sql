-- The seed in 0040 used min(uuid), which Postgres has no aggregate for. The
-- columns and indexes were created before it failed, so only this part is left.
--
-- Still only assigning where a tenant has exactly ONE category: with two or
-- more, "which brand is this" has no answer that cannot be wrong, and a guess
-- that looks like a fact is worse than a blank somebody has to fill in.
SET app.bypass = 'on';

UPDATE master_products p
SET shop_category_id = (
    SELECT c.id FROM shop_categories c
    WHERE c.user_id = p.user_id
    ORDER BY c.sort_order, c.created_at
    LIMIT 1
)
WHERE p.shop_category_id IS NULL
  AND (SELECT count(*) FROM shop_categories c WHERE c.user_id = p.user_id) = 1;

UPDATE materials m
SET shop_category_id = (
    SELECT c.id FROM shop_categories c
    WHERE c.user_id = m.user_id
    ORDER BY c.sort_order, c.created_at
    LIMIT 1
)
WHERE m.shop_category_id IS NULL
  AND (SELECT count(*) FROM shop_categories c WHERE c.user_id = m.user_id) = 1;

SELECT 'produk berbrand: ' || count(*) FROM master_products WHERE shop_category_id IS NOT NULL;
SELECT 'bahan berbrand: '  || count(*) FROM materials       WHERE shop_category_id IS NOT NULL;
SELECT 'kategori per tenant: ' || string_agg(n::text, ', ')
FROM (SELECT count(*) AS n FROM shop_categories GROUP BY user_id) x;

RESET app.bypass;
