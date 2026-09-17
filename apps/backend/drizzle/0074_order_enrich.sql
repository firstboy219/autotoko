-- 0074: perkaya order dgn data TikTok (price detail + tracking) + estimasi komisi.
-- Additive & idempotent.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_detail jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_last jsonb;
ALTER TABLE order_settings
  ADD COLUMN IF NOT EXISTS est_commission_rate numeric(5,4) NOT NULL DEFAULT 0.0800;
