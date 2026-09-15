-- Fase 1 — Retur/refund (Reverse Order). Fondasi additif: tabel retur + RLS.
-- Diisi oleh sinkron POST /return_refund/202309/returns/search (dorman sampai
-- scope aktif). Setujui/tolak = aksi tulis-balik menyusul (manual + konfirmasi).
CREATE TABLE IF NOT EXISTS marketplace_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  marketplace varchar(32) NOT NULL DEFAULT 'tiktok',
  return_id varchar(128) NOT NULL,
  order_id varchar(64),
  return_type varchar(48),            -- REFUND | RETURN_AND_REFUND | REPLACEMENT
  return_status varchar(64),          -- RETURN_OR_REFUND_REQUEST_PENDING dst
  arbitration_status varchar(48),
  role varchar(24),                   -- BUYER | SELLER | OPERATOR | SYSTEM
  reason_text text,
  refund_total numeric(15,2),
  currency varchar(8),
  buyer_user_id varchar(64),
  line_items jsonb,
  seller_next_action varchar(64),
  next_action_deadline timestamptz,
  return_create_time timestamptz,
  return_update_time timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_returns_unik UNIQUE (user_id, marketplace, return_id)
);
CREATE INDEX IF NOT EXISTS marketplace_returns_user_idx ON marketplace_returns(user_id);
CREATE INDEX IF NOT EXISTS marketplace_returns_status_idx ON marketplace_returns(user_id, return_status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketplace_returns'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I FOR ALL
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass', true) = 'on')
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass', true) = 'on')$f$, t);
  END LOOP;
END $$;
