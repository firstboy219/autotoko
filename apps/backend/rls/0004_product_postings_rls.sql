-- product_postings: penulis/pembaca semua authed (catalog/products/bom), tak ada
-- jalur contextless -> aman di-RLS. Tenant via shop_id -> shops.
ALTER TABLE product_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_postings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_postings;
CREATE POLICY tenant_isolation ON product_postings FOR ALL
  USING (current_setting('app.bypass', true) = 'on'
         OR shop_id IN (SELECT id FROM shops WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR shop_id IN (SELECT id FROM shops WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid));

\echo === verifikasi product_postings ===
SELECT relrowsecurity rls_on, relforcerowsecurity forced FROM pg_class WHERE relname='product_postings';
BEGIN; SELECT set_config('app.bypass','on',true); SELECT count(*) AS bypass_all FROM product_postings; COMMIT;
BEGIN; SELECT set_config('app.user_id','fa7616ce-96ee-4331-abc2-975d6512c74e',true); SELECT count(*) AS tenantA FROM product_postings; COMMIT;
BEGIN; SELECT count(*) AS no_ctx FROM product_postings; COMMIT;
