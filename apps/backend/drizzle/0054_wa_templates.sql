-- Template pesan WhatsApp pencairan, per tenant.
--
-- Boleh kosong, dan kosong berarti "pakai bawaan" -- bukan "kirim pesan
-- kosong". Pemilik yang tidak pernah menyentuh pengaturan ini harus mendapat
-- teks yang sama persis dengan sebelum fiturnya ada.
--
-- Aditif. Tidak ada baris yang diubah.
ALTER TABLE payout_settings ADD COLUMN IF NOT EXISTS wa_template_seller text;
ALTER TABLE payout_settings ADD COLUMN IF NOT EXISTS wa_template_sub_seller text;
