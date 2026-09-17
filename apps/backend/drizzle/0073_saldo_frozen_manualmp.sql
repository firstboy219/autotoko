-- 0073: watermark saldo (shops.saldo_frozen) + marketplace input manual (payout_settings).
-- Additive & idempotent.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS saldo_frozen jsonb;
ALTER TABLE payout_settings
  ADD COLUMN IF NOT EXISTS manual_input_marketplaces jsonb DEFAULT '["shopee"]'::jsonb;
