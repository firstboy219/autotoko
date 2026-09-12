-- Kode batch 5 karakter yang bisa dibaca dan disebut orang.
--
-- UUID sudah ada dan tetap jadi kunci sebenarnya; ini untuk dipakai manusia:
-- disebut di WhatsApp, ditulis di catatan, dicocokkan lewat telepon. Karena
-- itu abjadnya membuang karakter yang mudah tertukar saat dibaca atau diketik
-- (0/O, 1/I/L), tersisa 30 karakter -- 30^5 sekitar 24 juta kombinasi.
ALTER TABLE payout_batches
    ADD COLUMN IF NOT EXISTS code varchar(5);

-- Unik per tenant, bukan global: kodenya hanya berarti di dalam satu bisnis,
-- dan menguniknya lintas tenant hanya akan mempercepat habisnya kombinasi.
CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_code_idx
    ON payout_batches (user_id, code)
    WHERE code IS NOT NULL;
