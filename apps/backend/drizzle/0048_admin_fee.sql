-- Fee admin per batch: pengaturannya, dan buktinya.
--
-- Fee ini BUKAN bagian dari pembagian pencairan. Sedekah, sub-seller, dan
-- jatah bahan baku semuanya dipotong DARI kredit yang cair; fee admin adalah
-- ongkos yang dibayar terpisah, satu kali per batch. Karena itu ia tidak
-- masuk payout_disbursements -- menaruhnya di sana akan mencampurnya ke dalam
-- setiap penjumlahan, rekonsiliasi, dan pesan WhatsApp yang sudah ada, dan
-- mengubah arti angka-angka yang sudah dipakai.

ALTER TABLE payout_settings
    ADD COLUMN IF NOT EXISTS admin_fee_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS admin_fee_amount numeric(15, 2) NOT NULL DEFAULT 20000;

-- Nominalnya DIREKAM ULANG di batch, bukan dibaca dari pengaturan saat
-- ditampilkan. Pengaturannya bisa berubah bulan depan, sedangkan fee sebuah
-- batch adalah yang berlaku ketika batch itu jalan -- aturan yang sama dengan
-- tarif sedekah dan sub-seller yang sudah disimpan per mutasi.
ALTER TABLE payout_batches
    ADD COLUMN IF NOT EXISTS admin_fee_amount numeric(15, 2),
    ADD COLUMN IF NOT EXISTS admin_fee_proof_url text,
    ADD COLUMN IF NOT EXISTS admin_fee_proof_hash text,
    ADD COLUMN IF NOT EXISTS admin_fee_paid_at timestamptz;

-- Satu bukti tidak boleh dipakai untuk dua batch, dengan alasan yang sama
-- seperti bukti pencairan: gambar yang sama diunggah dua kali mendapat nama
-- berbeda, jadi yang membedakan cuma isinya.
CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_fee_hash_idx
    ON payout_batches (user_id, admin_fee_proof_hash)
    WHERE admin_fee_proof_hash IS NOT NULL;
