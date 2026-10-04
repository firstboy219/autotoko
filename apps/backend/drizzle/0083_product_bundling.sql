-- 0083 Produk bundling.
-- Satu master produk (bundle) tersusun dari beberapa master produk komponen.
-- HPP bundle dihitung aplikasi: Σ(biaya produksi komponen × qty) + packing bundle 1×.
-- Aditif & idempotent; aman dijalankan ulang. Rollback: DROP TABLE product_bundle_items;
CREATE TABLE IF NOT EXISTS product_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  quantity numeric(10,3) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_bundle_items_bundle_idx
  ON product_bundle_items(bundle_product_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_bundle_items_bundle_comp_unique
  ON product_bundle_items(bundle_product_id, component_product_id);
