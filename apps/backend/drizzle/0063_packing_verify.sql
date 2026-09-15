-- Fase 1 — Scan-verify packing. Catatan verifikasi isi paket saat packing
-- (cegah salah kirim). Additif; satu baris verifikasi TERAKHIR per order (upsert).

CREATE TABLE IF NOT EXISTS packing_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL,               -- 'ok' | 'discrepancy'
  items jsonb,                               -- snapshot [{name, sku, expected, checked}]
  note text,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packing_verifications_unik UNIQUE (user_id, order_id)
);
CREATE INDEX IF NOT EXISTS packing_verifications_user_idx ON packing_verifications(user_id);
CREATE INDEX IF NOT EXISTS packing_verifications_order_idx ON packing_verifications(order_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['packing_verifications'] LOOP
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
