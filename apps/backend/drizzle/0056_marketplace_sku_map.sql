-- Terjemahan ID SKU marketplace -> produk di katalog.
--
-- KENAPA PERLU TABEL SENDIRI. Laporan penyelesaian TikTok menyebut isi tiap
-- pesanan sebagai ID SKU ("1731350028413076965 * 1;"), bukan nama. ID itu
-- tidak ada di mana pun selain laporannya -- sudah dicari ke seluruh kolom
-- teks di basis data ini. master_products.marketplace_aliases menyimpan JUDUL
-- IKLAN, yang berbeda hal dan tidak boleh dipakai ulang untuk ini: satu produk
-- bisa punya banyak SKU (varian, toko berbeda), dan menimpanya akan merusak
-- pencocokan judul yang sudah jalan.
--
-- KENAPA DIPETAKAN MANUAL, BUKAN DITEBAK DARI HARGA. Pada katalog ini harga
-- 39.300 dipakai "Inhaler Regular Peppermint" DAN "Siwak Spray 50ml"; 49.300
-- dipakai tiga produk sekaligus. Tebakan harga menghasilkan nama yang rapi
-- tapi keliru, dan di layar audit nama yang salah lebih berbahaya daripada
-- tidak ada nama -- orang bertindak atas nama yang terbaca. Harga tetap
-- dipakai untuk MENYARANKAN calon, tidak pernah untuk memutuskan.
--
-- Aditif. Tidak ada tabel atau baris lama yang diubah.
CREATE TABLE IF NOT EXISTS marketplace_sku_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- "tiktok" / "tokopedia" / "shopee". Disimpan karena ID SKU hanya unik di
  -- dalam satu marketplace; dua marketplace boleh memakai angka yang sama.
  marketplace   varchar(32) NOT NULL,
  -- ID SKU sebagaimana tertulis di laporan, apa adanya.
  sku           varchar(128) NOT NULL,
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  -- Siapa yang memetakan dan kapan: pemetaan ini adalah keputusan manusia,
  -- dan sesudahnya harus bisa ditelusuri siapa yang memutuskan.
  mapped_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Satu SKU hanya boleh menunjuk satu produk per tenant per marketplace.
-- Tanpa ini, pemetaan yang diperbaiki akan menumpuk dan layar akan memilih
-- salah satunya secara acak.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_sku_map_unik
  ON marketplace_sku_map(user_id, marketplace, sku);

ALTER TABLE marketplace_sku_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_sku_map FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON marketplace_sku_map;
CREATE POLICY tenant_isolation ON marketplace_sku_map
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid);
