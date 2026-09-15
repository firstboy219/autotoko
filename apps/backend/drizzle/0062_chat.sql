-- Fase 1 — Chat pelanggan (TikTok IM). Fondasi additif: tabel percakapan &
-- pesan + RLS tenant. Sinkronisasi/kirim ke TikTok IM menyusul (dorman sampai
-- scope IM diaktifkan). AMAN: hanya menambah tabel, tak menyentuh yang ada.

CREATE TABLE IF NOT EXISTS marketplace_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  marketplace varchar(32) NOT NULL DEFAULT 'tiktok',
  conversation_id varchar(128) NOT NULL,
  buyer_name varchar(255),
  last_message text,
  last_message_at timestamptz,
  unread integer NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_conversations_unik UNIQUE (user_id, marketplace, conversation_id)
);
CREATE INDEX IF NOT EXISTS marketplace_conversations_user_idx ON marketplace_conversations(user_id);
CREATE INDEX IF NOT EXISTS marketplace_conversations_last_idx ON marketplace_conversations(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES marketplace_conversations(id) ON DELETE CASCADE,
  marketplace_message_id varchar(128),
  direction varchar(16) NOT NULL,          -- 'in' | 'out'
  sender varchar(16),                      -- 'buyer' | 'seller' | 'system'
  text text,
  status varchar(16) NOT NULL DEFAULT 'sent', -- out: queued|sent|failed ; in: received
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_messages_conv_idx ON marketplace_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS marketplace_messages_user_idx ON marketplace_messages(user_id);

-- RLS tenant (wajib: FORCE + form nullif, sama dengan tabel tenant lain).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketplace_conversations','marketplace_messages'] LOOP
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
