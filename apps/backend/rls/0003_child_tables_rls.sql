-- S1 lanjut: RLS defense-in-depth utk tabel ANAK (tenant lewat FK, tanpa user_id).
-- Policy subquery ke induk, aman-bypass. HANYA 8 tabel yg penulisnya authed atau
-- pakai runBypass. DITUNDA (penulis background/webhook contextless, bisa patah):
-- webhook_events, wallet_transactions, product_postings -> perlu penulisnya
-- pindah ke runBypass dulu.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('master_product_variants','master_product_id','master_products'),
    ('bom_items','master_product_id','master_products'),
    ('product_packing_quantities','master_product_id','master_products'),
    ('chat_logs','shop_id','shops'),
    ('review_logs','shop_id','shops'),
    ('order_api_snapshots','shop_id','shops'),
    ('fulfillment_api_snapshots','shop_id','shops'),
    ('resi_scan_items','resi_scan_id','resi_scans')
  ) AS x(tbl, fk, parent) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I FOR ALL
      USING (current_setting('app.bypass', true) = 'on'
             OR %I IN (SELECT id FROM %I WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid))
      WITH CHECK (current_setting('app.bypass', true) = 'on'
             OR %I IN (SELECT id FROM %I WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    $f$, r.tbl, r.fk, r.parent, r.fk, r.parent);
  END LOOP;
END $$;

\echo === verifikasi status 8 tabel anak ===
SELECT c.relname, c.relrowsecurity rls_on, c.relforcerowsecurity forced,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename=c.relname) n_policy
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN
   ('master_product_variants','bom_items','product_packing_quantities','chat_logs',
    'review_logs','order_api_snapshots','fulfillment_api_snapshots','resi_scan_items')
 ORDER BY c.relname;

\echo === uji resi_scan_items: bypass(all) / tenant(scoped) / tanpa-konteks(0, no error) ===
BEGIN; SELECT set_config('app.bypass','on',true); SELECT count(*) AS bypass_all FROM resi_scan_items; COMMIT;
BEGIN; SELECT set_config('app.user_id','fa7616ce-96ee-4331-abc2-975d6512c74e',true); SELECT count(*) AS tenantA FROM resi_scan_items; COMMIT;
BEGIN; SELECT count(*) AS no_ctx FROM resi_scan_items; COMMIT;
