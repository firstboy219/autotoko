-- 0067: Fix tenant_isolation RLS policies that cast app.user_id to uuid WITHOUT
-- NULLIF. Under this.bypass() the transaction sets app.bypass='on' but leaves
-- app.user_id unset/empty; because OR operands in a policy qual are not
-- guaranteed to short-circuit, Postgres still evaluates ('')::uuid and raises
-- `invalid input syntax for type uuid: ""`. This broke batch packing (the
-- skuToMaster join reads marketplace_sku_map under bypass). The other tenant
-- tables already use NULLIF(...,''); this aligns the three that did not.
-- Corrective + idempotent; no data is modified and isolation is preserved
-- (an empty app.user_id now denies rather than erroring).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketplace_sku_map','stock_requests','stock_request_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING ((current_setting('app.bypass', true) = 'on')
               OR (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
        WITH CHECK ((current_setting('app.bypass', true) = 'on')
               OR (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
    $f$, t);
  END LOOP;
END $$;
