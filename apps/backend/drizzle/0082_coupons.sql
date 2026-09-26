-- 0082: Kupon/Voucher TikTok — cache/riwayat + pengaturan otomasi.
-- Aditif & idempotent. API kupon TikTok READ-ONLY (search/get saja; tak ada
-- create/edit via API) -> tabel ini menampung hasil sinkron untuk tampilan
-- cepat, rekap, dan deteksi sinyal otomasi (segera berakhir / klaim hampir
-- habis / nol klaim). Tenancy: filter user_id di service (pola kb_entries).

CREATE TABLE IF NOT EXISTS marketplace_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  coupon_id varchar(64) NOT NULL,
  title text,
  status varchar(24),
  display_type varchar(24),
  product_scope varchar(32),
  target_buyer_segment varchar(32),
  creation_source varchar(32),
  discount_type varchar(24),        -- AMOUNT_OFF | PERCENTAGE_OFF
  discount_amount numeric(15,2),    -- utk AMOUNT_OFF
  discount_pct numeric(6,2),        -- utk PERCENTAGE_OFF
  max_discount numeric(15,2),       -- batas potongan utk PERCENTAGE_OFF
  currency varchar(8),
  min_spend numeric(15,2),
  claim_start timestamptz,
  claim_end timestamptz,
  redemption_limit integer,
  per_buyer_limit integer,
  claimed_count integer NOT NULL DEFAULT 0,
  redeemed_count integer NOT NULL DEFAULT 0,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_coupons_unik ON marketplace_coupons(user_id, coupon_id);
CREATE INDEX IF NOT EXISTS marketplace_coupons_user_idx ON marketplace_coupons(user_id, status);

-- Pengaturan otomasi kupon per seller. Default: pantauan alert AKTIF (read-only,
-- tak mengubah apa pun di TikTok), auto-sync tiap 6 jam.
CREATE TABLE IF NOT EXISTS coupon_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_sync boolean NOT NULL DEFAULT true,
  alert_expiry boolean NOT NULL DEFAULT true,
  expiry_days smallint NOT NULL DEFAULT 3,
  alert_limit boolean NOT NULL DEFAULT true,
  limit_pct smallint NOT NULL DEFAULT 80,
  alert_zero_claim boolean NOT NULL DEFAULT true,
  zero_claim_days smallint NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);
