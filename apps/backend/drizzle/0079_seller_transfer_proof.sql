-- 0079: Bukti transfer BAGIAN SELLER per batch pencairan (opsional).
-- Aditif & idempotent (IF NOT EXISTS). Batch lama sebelum fitur ini dibiarkan
-- NULL = tanpa bukti. Tidak menyentuh data/tabel lain. Tenancy tetap dijaga
-- filter user_id di service (payout_batches sudah punya RLS-nya sendiri).

ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS seller_transfer_proof_url text;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS seller_transfer_proof_hash text;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS seller_transfer_paid_at timestamptz;
