-- Satu produk boleh masuk beberapa kategori.
--
-- Kategori toko sudah ada (shop_categories: JackHealer, Renature) dan sudah
-- dipakai master produk lewat satu kolom shop_category_id. Satu kolom berarti
-- satu kategori, dan itu memaksa produk yang memang dijual di bawah dua brand
-- untuk memilih salah satu.
--
-- Kolom lamanya TIDAK dihapus. Ia dipakai penyaring di halaman produk dan di
-- shop-insights; membuangnya berarti mengubah arti kueri yang sudah berjalan.
-- Sekarang ia menjadi kategori UTAMA -- yang pertama dari daftar -- sementara
-- tabel ini menyimpan seluruhnya. Penyaring lama tetap bekerja, dan yang baru
-- melihat semuanya.
--
-- Tabelnya diisi dari kolom lama supaya hari pertama tidak menampilkan 26
-- produk yang tiba-tiba kehilangan kategorinya. Itu menambah baris turunan
-- dari data yang sudah ada, bukan mengubah satu pun nilai lama.

CREATE TABLE IF NOT EXISTS master_product_categories (
    product_id       uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
    shop_category_id uuid NOT NULL REFERENCES shop_categories(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, shop_category_id)
);

CREATE INDEX IF NOT EXISTS master_product_categories_user_idx
    ON master_product_categories (user_id, shop_category_id);

ALTER TABLE master_product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON master_product_categories;
CREATE POLICY tenant_isolation ON master_product_categories
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );

-- Isi dari yang sudah ada. ON CONFLICT supaya migrasi ini aman dijalankan ulang.
--
-- app.bypass WAJIB: master_products memakai RLS, dan tanpa ini SELECT di
-- dalam INSERT mengembalikan nol baris. Migrasinya lalu "berhasil" tanpa
-- mengisi apa pun -- kegagalan yang menyamar sebagai sukses.
SET app.bypass = 'on';

INSERT INTO master_product_categories (product_id, shop_category_id, user_id)
SELECT id, shop_category_id, user_id
  FROM master_products
 WHERE shop_category_id IS NOT NULL
ON CONFLICT DO NOTHING;

SELECT 'kategori produk terisi: ' || count(*) FROM master_product_categories;

RESET app.bypass;
