-- Rollback for enable-rls.sql. Drops the tenant_isolation policies and disables
-- RLS on all affected tables, restoring app-layer-only isolation. Run this (and
-- set RLS_ENABLED=false) if any query path breaks under RLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','wallets','shops','master_products','orders','affiliates',
    'platform_invoices','autopilot_activity','notifications'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
