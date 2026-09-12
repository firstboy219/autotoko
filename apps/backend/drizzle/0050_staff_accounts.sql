-- Akun karyawan: orang lain yang bekerja atas toko yang sama.
--
-- Sebelum ini satu tenant = satu baris users, dan satu-satunya cara memberi
-- akses ke karyawan adalah menyerahkan password pemiliknya. Itu berarti tidak
-- ada jejak siapa melakukan apa, dan tidak ada cara mencabut akses satu orang
-- tanpa mengganti password semua orang.
--
-- Akun karyawan sengaja BUKAN baris di users. Satu baris users berarti satu
-- tenant di seluruh sistem -- ia punya wallet, paket langganan, tagihan, dan
-- muncul di panel admin. Karyawan tidak punya satu pun dari itu; ia hanya
-- sebuah cara masuk ke data pemiliknya. Menaruhnya di users akan membuat
-- setiap kueri yang mengasumsikan "satu users = satu toko" diam-diam salah.
--
-- Token yang diterbitkan untuk karyawan tetap memakai sub = users.id PEMILIK,
-- persis seperti token portal sub-seller yang sudah ada. Dengan begitu RLS,
-- app.user_id, dan seluruh kueri yang ada tidak berubah sama sekali; yang
-- membatasi karyawan adalah lapisan izin di guard, bukan tenancy.

CREATE TABLE IF NOT EXISTS staff_accounts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Pemiliknya. Menghapus pemilik menghapus karyawannya.
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          varchar(255) NOT NULL,
    email         varchar(255) NOT NULL,
    password_hash varchar(255) NOT NULL,

    -- Daftar kunci modul, misalnya ["dashboard","scan"]. Disimpan sebagai
    -- daftar, bukan kolom boolean per modul: modulnya masih bertambah, dan
    -- menambah modul tidak boleh berarti migrasi kolom tiap kali.
    permissions   jsonb NOT NULL DEFAULT '[]'::jsonb,

    is_active     boolean NOT NULL DEFAULT true,

    -- Token yang diterbitkan sebelum saat ini ditolak. Distempel ketika
    -- password diganti atau akun dinonaktifkan, supaya pencabutan akses
    -- benar-benar mengusir sesi yang sedang berjalan -- bukan menunggu
    -- tokennya kedaluwarsa dua belas jam lagi.
    sessions_valid_from timestamptz,
    last_login_at timestamptz,

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Email unik SE-SISTEM, bukan per pemilik: ia dipakai untuk login, dan dua
-- baris dengan email sama membuat "siapa yang masuk" tidak punya jawaban.
CREATE UNIQUE INDEX IF NOT EXISTS staff_accounts_email_unique
    ON staff_accounts (lower(email));

CREATE INDEX IF NOT EXISTS staff_accounts_user_idx
    ON staff_accounts (user_id);

ALTER TABLE staff_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON staff_accounts;
CREATE POLICY tenant_isolation ON staff_accounts
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );
