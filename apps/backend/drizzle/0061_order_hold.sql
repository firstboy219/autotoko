-- 0061: catatan "takeout" saat batch packing (order ditahan, tidak dikirim).
-- Aditif, dua kolom nullable pada orders. Tak menyentuh baris lama.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS held_at timestamptz;
