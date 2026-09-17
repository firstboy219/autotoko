-- 0068: kolom cutoff Saldo Cepat di shops (additive, nullable).
-- Untuk toko yg pakai program Saldo Cepat: setelah program dimatikan, seller
-- input saldo bisa-ditarik saat ini + tanggalnya; saldo berikutnya = cutoff +
-- (SETTLE - WITHDRAW sukses) sejak tanggal cutoff. Non-destruktif.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS saldo_cutoff_date date;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS saldo_cutoff_amount numeric(15,2);
