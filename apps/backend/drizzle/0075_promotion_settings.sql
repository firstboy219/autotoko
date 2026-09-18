-- 0075: pengaturan promosi per toko (auto-ikut). Additive & idempotent.
CREATE TABLE IF NOT EXISTS promotion_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  auto_join   boolean NOT NULL DEFAULT false,
  activity_id varchar(128),
  discount_pct numeric(5,2) NOT NULL DEFAULT 10,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_settings_user_shop_uq UNIQUE (user_id, shop_id)
);
