-- Sinkronisasi pesanan & produk dari API TikTok Shop.
--
-- ATURAN YANG DIJAGA: yang dikatakan marketplace disimpan di tabel MILIK
-- marketplace. Tidak satu pun baris di sini menulis ke payout_mutations,
-- resi_scans, atau material_*. Manual tetap sumber yang dipakai MENGHITUNG
-- uang; yang dari API dipakai MEMERIKSANYA. Urutan ini disengaja.
--
-- Aditif seluruhnya: tiga tabel baru dan tiga kolom nullable pada orders.
-- Tidak ada baris lama yang diubah nilainya.

-- Produk sebagaimana terdaftar di marketplace. Bukan product_postings:
-- tabel itu mensyaratkan master_product_id NOT NULL, sedangkan produk yang
-- baru ditarik dari marketplace belum tentu punya padanan di katalog -- dan
-- memaksakan padanan berarti menebak, yang di layar audit lebih berbahaya
-- daripada tidak menebak.
CREATE TABLE IF NOT EXISTS marketplace_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  marketplace   varchar(32) NOT NULL,
  product_id    varchar(64) NOT NULL,
  title         text,
  status        varchar(40),
  raw           jsonb,
  updated_at_marketplace timestamptz,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_products_unik
  ON marketplace_products(user_id, marketplace, product_id);
CREATE INDEX IF NOT EXISTS marketplace_products_shop_idx ON marketplace_products(shop_id);

-- SKU adalah kunci yang menghubungkan tiga dunia: laporan penyelesaian
-- ("Detail produk terjual" berisi ID SKU), pesanan (line_items.sku_id), dan
-- katalog (lewat marketplace_sku_map). Nama SKU tidak ada di daftar produk
-- tapi ADA di line item pesanan, jadi kolom nama diisi dari mana pun ia
-- pertama kali terlihat dan tidak ditimpa dengan null sesudahnya.
CREATE TABLE IF NOT EXISTS marketplace_skus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  marketplace   varchar(32) NOT NULL,
  product_id    varchar(64),
  sku_id        varchar(64) NOT NULL,
  seller_sku    varchar(128),
  sku_name      varchar(255),
  product_name  varchar(500),
  price         numeric(15,2),
  currency      varchar(8),
  stock         integer,
  raw           jsonb,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_skus_unik
  ON marketplace_skus(user_id, marketplace, sku_id);
CREATE INDEX IF NOT EXISTS marketplace_skus_shop_idx ON marketplace_skus(shop_id);

-- Tiap sinkronisasi dicatat: kapan, berapa yang ditarik, sampai mana, dan
-- kalau gagal kenapa. Tanpa ini "sudah sinkron?" hanya bisa dijawab dengan
-- menebak dari jumlah baris, dan sinkronisasi bertahap tidak punya titik
-- lanjut yang bisa dipercaya.
CREATE TABLE IF NOT EXISTS marketplace_sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  marketplace   varchar(32) NOT NULL,
  -- 'orders' | 'products'
  kind          varchar(16) NOT NULL,
  -- 'running' | 'ok' | 'failed'
  status        varchar(16) NOT NULL DEFAULT 'running',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  -- Batas bawah update_time yang diminta ke marketplace pada run ini.
  since         timestamptz,
  -- update_time terbesar yang terlihat; titik lanjut run berikutnya.
  watermark     timestamptz,
  pages         integer NOT NULL DEFAULT 0,
  fetched       integer NOT NULL DEFAULT 0,
  upserted      integer NOT NULL DEFAULT 0,
  error         text,
  -- 'cron' | 'manual'
  triggered_by  varchar(16) NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS marketplace_sync_runs_shop_idx
  ON marketplace_sync_runs(shop_id, kind, started_at DESC);

-- Kolom tambahan pada orders. Nullable, tanpa default yang mengubah baris
-- lama: 16 baris yang sudah ada tetap persis seperti sebelumnya.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at_marketplace timestamptz;
-- TikTok Shop memuat pesanan Tokopedia juga ("commerce_platform"); potongan
-- keduanya terukur berbeda (42% lawan 36%), jadi asalnya harus disimpan.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commerce_platform varchar(32);

ALTER TABLE marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_products FORCE ROW LEVEL SECURITY;
ALTER TABLE marketplace_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_skus FORCE ROW LEVEL SECURITY;
ALTER TABLE marketplace_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_sync_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON marketplace_products;
CREATE POLICY tenant_isolation ON marketplace_products
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON marketplace_skus;
CREATE POLICY tenant_isolation ON marketplace_skus
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON marketplace_sync_runs;
CREATE POLICY tenant_isolation ON marketplace_sync_runs
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid);
