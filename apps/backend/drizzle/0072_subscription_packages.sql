-- 0072: paket langganan DINAMIS (di luar 3 tier bawaan) + users.package_code.
-- Additive & idempotent. Tier bawaan (freemium/starter/pro) tetap di pricing_config.
CREATE TABLE IF NOT EXISTS subscription_packages (
  code                 varchar(64) PRIMARY KEY,
  name                 varchar(120) NOT NULL,
  setup_fee            numeric(15,2) NOT NULL DEFAULT 0,
  monthly_fee          numeric(15,2) NOT NULL DEFAULT 0,
  per_transaction_fee  numeric(15,2) NOT NULL DEFAULT 0,
  max_shops            integer,
  max_orders_per_month integer,
  features             jsonb DEFAULT '{}'::jsonb,
  activity_fees        jsonb DEFAULT '{}'::jsonb,
  is_active            boolean NOT NULL DEFAULT true,
  sort_order           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS package_code varchar(64);
