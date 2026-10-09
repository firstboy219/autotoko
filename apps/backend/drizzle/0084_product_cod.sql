-- 0084 Opsi COD per produk (desired state) di product_costing.
-- null = jangan ubah / ikut marketplace; true = aktifkan; false = matikan.
-- Aditif & idempotent.
ALTER TABLE product_costing ADD COLUMN IF NOT EXISTS cod_enabled boolean;
