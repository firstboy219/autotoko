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
    'platform_invoices','autopilot_activity','notifications',
    'sub_sellers','sub_sub_sellers','payout_settings',
    'payout_batches','payout_mutations','payout_adjustments',
    'payout_disbursements','product_costing','materials','material_purchases','material_purchase_items','password_reset_tokens','resi_scans','packing_settings','shop_categories','packing_materials','user_ui_prefs','resi_scan_photos','payout_carryovers','marketplace_conversations','marketplace_messages','custom_couriers','marketplace_statement_lines','marketplace_statements','master_product_categories','material_movements','ocr_corrections','order_settings','resi_scan_codes','staff_accounts'
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


-- S1: tabel ANAK (tenant lewat FK, tanpa user_id) -- policy subquery ke induk,
-- aman-bypass. Ditunda (penulis background/webhook contextless): webhook_events,
-- wallet_transactions, product_postings -> pindahkan penulisnya ke runBypass dulu.
DO $anak$
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
END $anak$;
