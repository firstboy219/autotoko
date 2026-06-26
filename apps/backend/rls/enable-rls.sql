-- Postgres Row-Level Security for tenant isolation (defense-in-depth on top of
-- the app-layer user_id filtering). Applied/reverted deliberately via the DB
-- tunnel — NOT part of the drizzle migration journal. Pair with RLS_ENABLED=true
-- and the TenantService request/cron context (which SET app.user_id / app.bypass).
--
-- Owner (autotoko_user) would normally bypass RLS, so FORCE is required. A row is
-- visible only when it belongs to the current app.user_id, OR app.bypass='on'
-- (cron jobs, webhooks, admin, unauthenticated paths).

-- user_id-keyed tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wallets','shops','master_products','orders','affiliates',
    'platform_invoices','autopilot_activity','notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
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

-- users table is keyed on its own id (the user IS the row)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users FOR ALL
  USING (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.bypass', true) = 'on'
  )
  WITH CHECK (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.bypass', true) = 'on'
  );
