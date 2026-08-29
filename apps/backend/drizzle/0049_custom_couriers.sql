-- Kurir tambahan milik seller sendiri.
--
-- Daftar kurir selama ini hidup di kode dengan alasan "sama untuk semua seller
-- di Indonesia". Itu benar untuk kurir nasional dan meleset di gudang: ada
-- kurir lokal, ada layanan marketplace yang baru muncul, ada barang yang
-- diantar sendiri. Yang dipatok di kode tetap ada dan tetap jadi yang pertama
-- di daftar; tabel ini hanya menambah, tidak menggantikan.
--
-- name dibuat varchar(32) karena kolom yang nanti menyimpannya --
-- resi_scans.courier dan resi_scans.courier_confirmed -- juga varchar(32).
-- Membolehkan nama lebih panjang di sini berarti membuat kurir yang bisa
-- dibuat tapi gagal dipakai, dan kegagalannya baru muncul saat paket sedang
-- dipegang.

CREATE TABLE IF NOT EXISTS custom_couriers (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       varchar(32) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_couriers_user_idx
    ON custom_couriers (user_id);

-- Satu nama sekali saja per seller, tanpa peduli besar-kecil hurufnya:
-- "Sicepat" dan "SiCepat" akan tampil sebagai dua pilihan yang terlihat sama,
-- dan yang salah pilih tidak akan pernah sadar sudah salah.
CREATE UNIQUE INDEX IF NOT EXISTS custom_couriers_unique
    ON custom_couriers (user_id, lower(name));

ALTER TABLE custom_couriers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON custom_couriers;
CREATE POLICY tenant_isolation ON custom_couriers
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );
