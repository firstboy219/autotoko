-- 0069: cache hasil saldo TikTok per toko supaya kartu "Saldo bisa ditarik"
-- langsung tampil (nilai tersimpan terakhir) tanpa memanggil API tiap buka
-- halaman; tombol "Update saldo" yang menghitung live lalu memperbarui cache.
-- Additive, nullable.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS saldo_last jsonb;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS saldo_last_at timestamptz;
