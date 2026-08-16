-- Kode batch dipendekkan jadi 3 karakter, dan dibandingkan tanpa peduli
-- besar-kecil huruf.
--
-- Kodenya dibuat ULANG, bukan dipotong. Memotong "GVRF5" jadi "GVR" akan
-- menabrakkan dua kode yang tadinya berbeda hanya di ekornya, dan hasilnya
-- bukan kode acak lagi melainkan sisa potongan.
--
-- 30 karakter atas 3 tempat = 27.000 kombinasi. Jauh lebih kecil dari
-- sebelumnya tapi masih jauh lebih besar dari jumlah batch yang akan pernah
-- dibuka satu bisnis, dan keunikannya tetap dijamin indeks di bawah, bukan
-- oleh keberuntungan.

DROP INDEX IF EXISTS payout_batches_code_idx;

DO $$
DECLARE
  b record;
  a text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  k text;
  i int;
BEGIN
  -- Dikosongkan dulu supaya kode lama tidak ikut dihitung sebagai "terpakai"
  -- saat yang baru dicari.
  UPDATE payout_batches SET code = NULL;

  FOR b IN SELECT id, user_id FROM payout_batches LOOP
    LOOP
      k := '';
      FOR i IN 1..3 LOOP
        k := k || substr(a, 1 + floor(random() * length(a))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM payout_batches
        WHERE user_id = b.user_id AND upper(code) = upper(k));
    END LOOP;
    UPDATE payout_batches SET code = k WHERE id = b.id;
  END LOOP;
END $$;

ALTER TABLE payout_batches
    ALTER COLUMN code TYPE varchar(3);

-- Case-insensitive: "a7k" dan "A7K" adalah kode yang sama. Aplikasinya selalu
-- menulis huruf besar, tapi indeksnya yang menjamin -- bukan kebiasaan
-- pemanggilnya.
CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_code_idx
    ON payout_batches (user_id, upper(code))
    WHERE code IS NOT NULL;
