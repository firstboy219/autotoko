-- 0081: Pengaturan otomasi Chat Pelanggan per seller.
-- Aditif & idempotent. Tanpa RLS khusus (pola kb_entries) — tenancy dijaga
-- filter user_id di service. Default AMAN: balas otomatis MATI sampai seller
-- menyalakannya sendiri. Tidak menyentuh tabel/data lain.

CREATE TABLE IF NOT EXISTS chat_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_reply boolean NOT NULL DEFAULT false,
  -- null = semua toko; isi daftar id toko untuk membatasi (mis. uji 1 toko).
  auto_reply_shop_ids jsonb,
  -- jam kerja WIB (0-23); null = 24 jam.
  office_start smallint,
  office_end smallint,
  -- dikirim sekali (per 12 jam per percakapan) saat di luar jam kerja & KB tak cocok; null = tidak.
  fallback_text text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
