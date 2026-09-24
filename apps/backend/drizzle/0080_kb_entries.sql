-- 0080: Knowledge Base balasan otomatis ("AI internal", tanpa API vendor).
-- Aditif & idempotent. Per-tenant (user_id); tanpa RLS khusus (mengikuti pola
-- master_postings) — tenancy dijaga filter user_id di service. Tidak menyentuh
-- tabel lain.

CREATE TABLE IF NOT EXISTS kb_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL DEFAULT 'chat',
  keywords text NOT NULL,
  answer text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_entries_user_idx ON kb_entries(user_id, kind);
