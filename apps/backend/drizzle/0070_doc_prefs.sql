-- 0070: preferensi dokumen resi per-seller di order_settings.
-- Default SHIPPING_LABEL_AND_PACKING_SLIP (resi + packing slip berisi daftar
-- produk) + A6, bisa diubah user. Additive dengan default (baris lama ikut).
ALTER TABLE order_settings ADD COLUMN IF NOT EXISTS doc_type varchar(48) NOT NULL DEFAULT 'SHIPPING_LABEL_AND_PACKING_SLIP';
ALTER TABLE order_settings ADD COLUMN IF NOT EXISTS doc_size varchar(8) NOT NULL DEFAULT 'A6';
