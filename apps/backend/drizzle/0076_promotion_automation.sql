-- 0076: otomasi promosi per user. Additive & idempotent.
CREATE TABLE IF NOT EXISTS promotion_automation (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled                boolean NOT NULL DEFAULT false,
  dry_run                boolean NOT NULL DEFAULT true,
  only_ongoing           boolean NOT NULL DEFAULT true,
  min_uplift_pct         numeric(6,2) NOT NULL DEFAULT 10,
  require_profit         boolean NOT NULL DEFAULT true,
  min_orders             integer NOT NULL DEFAULT 5,
  auto_extend            boolean NOT NULL DEFAULT false,
  extend_days            integer NOT NULL DEFAULT 7,
  auto_replicate         boolean NOT NULL DEFAULT false,
  replicate_discount_pct numeric(5,2) NOT NULL DEFAULT 10,
  last_run_at            timestamptz,
  last_result            jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
