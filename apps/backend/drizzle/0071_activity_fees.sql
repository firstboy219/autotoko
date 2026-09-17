-- 0071: fee per aktivitas per paket (subscription) di pricing_config.
-- {order, shop_connect, product_create, audit_run, ...}. Additive, default {}.
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS activity_fees jsonb DEFAULT '{}'::jsonb;
