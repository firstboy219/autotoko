-- S1: tutup kebocoran lintas-tenant pada 9 tabel ber-user_id yang RLS-nya belum
-- FORCE (app connect sbg OWNER -> RLS non-forced dilewati) + normalkan policy ke
-- form NULLIF yang aman-bypass (7 tabel masih bare-cast -> throw saat bypass bila
-- di-force). Auth staff_accounts sudah pakai runBypass, jadi aman di-force.
DO $$
DECLARE t text; pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'custom_couriers','marketplace_statement_lines','marketplace_statements',
    'master_product_categories','material_movements','ocr_corrections',
    'order_settings','resi_scan_codes','staff_accounts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- buang SEMUA policy lama (termasuk yang bare-cast) supaya tak ada yang OR-throw
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol, t);
    END LOOP;
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I FOR ALL
      USING (
        user_id = nullif(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.bypass', true) = 'on'
      )
      WITH CHECK (
        user_id = nullif(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.bypass', true) = 'on'
      )$f$, t);
  END LOOP;
END $$;

\echo === verifikasi: status RLS 9 tabel sesudah fix ===
SELECT c.relname, c.relrowsecurity rls_on, c.relforcerowsecurity forced,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename=c.relname) AS n_policy
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('custom_couriers','marketplace_statement_lines','marketplace_statements',
     'master_product_categories','material_movements','ocr_corrections','order_settings',
     'resi_scan_codes','staff_accounts')
 ORDER BY c.relname;
