-- Sidik jari isi screenshot bukti pencairan.
--
-- URL tidak bisa dipakai untuk ini: mengunggah gambar yang sama dua kali
-- menghasilkan nama file acak yang berbeda, jadi dua baris dengan bukti
-- identik akan terlihat berbeda. Yang membedakan hanya isinya, maka yang
-- disimpan sidik jari isinya.
ALTER TABLE payout_mutations
    ADD COLUMN IF NOT EXISTS marketplace_proof_hash text;

-- Dua pencarian yang dijalankan tiap kali pencairan direkam: "pernahkah toko
-- ini dicairkan sebesar ini" dan "pernahkah screenshot ini dipakai".
CREATE INDEX IF NOT EXISTS payout_mutations_dupe_idx
    ON payout_mutations (user_id, shop_id, credit_amount);

CREATE INDEX IF NOT EXISTS payout_mutations_proof_hash_idx
    ON payout_mutations (user_id, marketplace_proof_hash)
    WHERE marketplace_proof_hash IS NOT NULL;
