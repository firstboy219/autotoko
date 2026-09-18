-- 0078: Master Postingan — template listing lintas toko + varian→SKU + mapping.
-- Aditif & idempotent (IF NOT EXISTS). Tanpa RLS (mengikuti master_products);
-- tenancy dijaga filter user_id di service. TIDAK menyentuh tabel lama.

CREATE TABLE IF NOT EXISTS master_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  description text,
  category_id integer,
  brand varchar(255),
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  variant_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_apply boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_postings_user_idx ON master_postings(user_id);

CREATE TABLE IF NOT EXISTS master_posting_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  master_posting_id uuid NOT NULL REFERENCES master_postings(id) ON DELETE CASCADE,
  combo jsonb NOT NULL DEFAULT '{}'::jsonb,
  combo_key varchar(255) NOT NULL,
  sku varchar(128),
  master_product_id uuid REFERENCES master_products(id) ON DELETE SET NULL,
  price numeric(15,2),
  stock integer,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS master_posting_skus_combo_unik ON master_posting_skus(master_posting_id, combo_key);
CREATE INDEX IF NOT EXISTS master_posting_skus_posting_idx ON master_posting_skus(master_posting_id);
CREATE INDEX IF NOT EXISTS master_posting_skus_master_idx ON master_posting_skus(master_product_id);

CREATE TABLE IF NOT EXISTS master_posting_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  master_posting_id uuid NOT NULL REFERENCES master_postings(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  marketplace varchar(32) NOT NULL,
  product_id varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'mapped',
  last_applied_at timestamptz,
  last_status varchar(20),
  last_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS master_posting_mappings_unik ON master_posting_mappings(master_posting_id, shop_id, product_id);
CREATE INDEX IF NOT EXISTS master_posting_mappings_posting_idx ON master_posting_mappings(master_posting_id);
CREATE INDEX IF NOT EXISTS master_posting_mappings_shop_idx ON master_posting_mappings(shop_id);
