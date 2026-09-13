-- Hirarki Katalog > Postingan > Varian di atas data sinkronisasi marketplace.
--
-- Postingan  = marketplace_products (satu listing di satu toko).
-- Varian     = marketplace_skus (satu SKU unik), dipetakan ke master lewat
--              marketplace_sku_map (per-varian, sudah ada).
-- Katalog    = kumpulan postingan yang merupakan PRODUK yang sama lintas toko.
--
-- Aditif seluruhnya: satu tabel baru + satu kolom nullable pada
-- marketplace_products. Tidak ada baris lama yang diubah, product_postings
-- TIDAK disentuh.

CREATE TABLE IF NOT EXISTS marketplace_catalogs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(255) NOT NULL,
  note        text,
  -- Kunci judul ternormalisasi yang dipakai pengelompokan otomatis. Disimpan
  -- supaya postingan baru bisa menempel ke katalog yang sudah ada tanpa
  -- menebak ulang, dan supaya penggabungan manual tidak tertimpa auto-group.
  match_key   varchar(64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_catalogs_user_idx ON marketplace_catalogs(user_id);
CREATE INDEX IF NOT EXISTS marketplace_catalogs_key_idx ON marketplace_catalogs(user_id, match_key);

-- Postingan menempel ke katalog. SET NULL saat katalog dihapus: postingannya
-- tidak ikut hilang, hanya lepas dari katalog.
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES marketplace_catalogs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS marketplace_products_catalog_idx ON marketplace_products(catalog_id);

ALTER TABLE marketplace_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_catalogs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_catalogs;
CREATE POLICY tenant_isolation ON marketplace_catalogs
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
