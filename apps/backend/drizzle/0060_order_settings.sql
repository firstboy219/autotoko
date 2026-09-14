-- 0060: order_settings — pengaturan otomasi order per-seller (menu Order).
-- Aditif seluruhnya. RLS memakai NULLIF(...,'') agar app.user_id kosong saat
-- bypass tidak melempar "invalid input syntax for uuid" (pelajaran migrasi 0058).
CREATE TABLE IF NOT EXISTS order_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_siap_kirim boolean NOT NULL DEFAULT false,
  instant_couriers jsonb NOT NULL DEFAULT '["instant","sameday","same day","same-day"]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON order_settings;
CREATE POLICY tenant_isolation ON order_settings
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
