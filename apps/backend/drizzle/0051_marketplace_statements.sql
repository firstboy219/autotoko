-- Apa kata marketplace, di samping apa yang dicatat manusia.
--
-- LATAR. Hari ini seluruh angka di sistem ini berasal dari tangan: pencairan
-- direkam dari struk penarikan, paket dihitung dari scan resi, bahan baku dari
-- scan barang datang. Nanti tiap toko akan tersambung ke API marketplace, dan
-- fakta yang sama akan datang dua kali -- sekali dari orang, sekali dari API.
--
-- Tanpa tabel ini, kedatangan kedua itu tidak punya tempat tinggal selain
-- menimpa atau menggandakan yang sudah ada. Dua-duanya merusak: menimpa
-- membuang catatan manusia yang justru jadi alat kontrolnya, menggandakan
-- membuat setiap angka di dashboard dihitung dua kali.
--
-- Jadi yang dikatakan marketplace disimpan TERPISAH, apa adanya, dan tidak
-- pernah menyentuh payout_mutations. Yang dibandingkan belakangan adalah
-- keduanya -- itulah fungsi audit yang diminta: manual mengontrol API, bukan
-- digantikan olehnya.
--
-- Sumbernya dibedakan lewat kolom `source`, bukan lewat tabel berbeda: hari
-- ini diisi dari berkas laporan yang diunduh sendiri ('report_import'), nanti
-- dari API ('api'). Bentuk datanya sama, jadi seluruh rekonsiliasi yang
-- dibangun di atasnya tidak perlu ditulis ulang ketika API menyala.
--
-- TIDAK ADA data lama yang diubah. Dua kolom yang ditambahkan ke
-- payout_mutations berdefault 'manual' dan NULL -- itu memang keadaan
-- sebenarnya dari 84 baris yang sudah ada, jadi menandainya bukan mengubah
-- artinya, melainkan menuliskan apa yang selama ini tersirat.

CREATE TABLE IF NOT EXISTS marketplace_statements (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Boleh NULL: sebuah laporan bisa diunggah sebelum tokonya dipetakan.
    shop_id       uuid REFERENCES shops(id) ON DELETE SET NULL,
    marketplace   varchar(24) NOT NULL,

    -- 'report_import' hari ini, 'api' nanti. Bentuk barisnya sama.
    source        varchar(24) NOT NULL DEFAULT 'report_import',

    period_from   date,
    period_to     date,
    currency      varchar(8),

    file_name     varchar(255),
    -- Isi berkasnya, bukan namanya: laporan yang sama diunduh ulang mendapat
    -- nama berbeda, dan mengimpornya dua kali akan melipatgandakan barisnya.
    file_hash     text,

    -- Ringkasan yang dilaporkan marketplace untuk periode itu, apa adanya.
    settlement_amount numeric(15, 2),
    total_income      numeric(15, 2),
    total_fees        numeric(15, 2),
    raw_summary       jsonb,

    imported_at   timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_statements_file_unique
    ON marketplace_statements (user_id, file_hash)
    WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_statements_shop_idx
    ON marketplace_statements (user_id, shop_id, period_from);

ALTER TABLE marketplace_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_statements;
CREATE POLICY tenant_isolation ON marketplace_statements
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );


-- Satu baris = satu kejadian yang dilaporkan marketplace.
CREATE TABLE IF NOT EXISTS marketplace_statement_lines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id  uuid NOT NULL REFERENCES marketplace_statements(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- withdrawal  : uang keluar dari saldo marketplace ke rekening bank.
    --               INI yang sebanding dengan payout_mutations.
    -- earnings    : penyelesaian masuk ke saldo. Bukan pencairan; dicatat
    --               karena tanpanya selisih saldo tidak bisa diterangkan.
    -- adjustment  : penyesuaian, pengembalian, denda.
    kind          varchar(24) NOT NULL,

    -- Nomor referensi milik marketplace. Inilah yang membuat impor ulang
    -- laporan yang tumpang tindih periodenya tidak menggandakan baris.
    external_ref  varchar(64),

    occurred_on   date NOT NULL,
    -- Apa adanya seperti di laporan: negatif berarti keluar dari saldo.
    -- Tidak dinormalkan supaya baris ini tetap bisa diadu dengan berkas asli.
    amount        numeric(15, 2) NOT NULL,

    bank_account  varchar(64),
    status        varchar(32),
    raw           jsonb,

    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_statement_lines_ref_unique
    ON marketplace_statement_lines (user_id, external_ref)
    WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_statement_lines_lookup_idx
    ON marketplace_statement_lines (user_id, kind, occurred_on);

ALTER TABLE marketplace_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_statement_lines;
CREATE POLICY tenant_isolation ON marketplace_statement_lines
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );


-- Asal-usul tiap pencairan, dan tautannya ke baris laporan.
--
-- Default 'manual' bukan tebakan: seluruh 84 baris yang ada memang direkam
-- tangan, dan sampai API menyala tidak ada cara lain sebuah baris bisa lahir.
-- Kolom ini menuliskan yang selama ini tersirat, bukan mengubahnya.
ALTER TABLE payout_mutations
    ADD COLUMN IF NOT EXISTS data_source varchar(16) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS external_ref varchar(64),
    ADD COLUMN IF NOT EXISTS reconciled_line_id uuid;

-- Sengaja tanpa foreign key ke marketplace_statement_lines: menghapus sebuah
-- laporan yang salah impor tidak boleh ikut menghapus atau mengunci pencairan
-- yang sudah tervalidasi. Tautan yang menggantung cukup diperlakukan sebagai
-- "belum tertaut".
CREATE INDEX IF NOT EXISTS payout_mutations_reconciled_idx
    ON payout_mutations (user_id, reconciled_line_id)
    WHERE reconciled_line_id IS NOT NULL;
