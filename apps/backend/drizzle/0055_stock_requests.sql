-- Permintaan pembelian stok (non-COD), dikirim ke pemasok lewat WhatsApp.
--
-- TABEL SENDIRI, bukan menumpang material_purchases. Sebuah permintaan bukan
-- pembelian: barangnya belum datang, stoknya belum boleh bertambah, dan
-- harganya belum boleh masuk perhitungan HPP. Menumpang tabel pembelian
-- berarti stok naik pada saat permintaan dibuat -- angka yang salah di rak dan
-- di HPP sekaligus, dan salahnya tidak terlihat sampai ada yang menghitung
-- fisik.
--
-- Aditif. Tidak ada tabel atau baris lama yang diubah.
CREATE TABLE IF NOT EXISTS stock_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Wajib: permintaan tanpa tangkapan layar tidak bisa diperiksa ulang oleh
  -- siapa pun sesudahnya.
  screenshot_url varchar(1024) NOT NULL,
  note          text,
  status        varchar(16) NOT NULL DEFAULT 'draft',
  total_cost    numeric(15,2) NOT NULL DEFAULT 0,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_request_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Boleh kosong: bahan yang belum ada di master tetap boleh diminta, dan
  -- memaksa membuat master dulu akan menghentikan orang di tengah pekerjaan.
  material_id   uuid REFERENCES materials(id) ON DELETE SET NULL,
  -- Apa yang tertulis di tangkapan layar marketplace.
  raw_name      varchar(255),

  -- Yang DIBELI, dalam satuan penjual: 2 botol.
  qty_pack      numeric(15,3) NOT NULL DEFAULT 1,
  pack_label    varchar(32),
  -- Isi tiap kemasan: 1 liter.
  content_per_pack numeric(15,3),
  content_unit  varchar(16),

  -- Hasil terjemahannya ke satuan master: 2000 ml. Disimpan, bukan dihitung
  -- ulang saat dibaca: aturan konversi bisa berubah, sedangkan yang dipesan
  -- kemarin tidak.
  qty_base      numeric(15,3),
  base_unit     varchar(16),

  unit_price    numeric(15,2),
  total_price   numeric(15,2),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_requests_user_idx ON stock_requests(user_id);
CREATE INDEX IF NOT EXISTS stock_request_items_req_idx ON stock_request_items(request_id);

ALTER TABLE stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_request_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON stock_requests;
CREATE POLICY tenant_isolation ON stock_requests
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON stock_request_items;
CREATE POLICY tenant_isolation ON stock_request_items
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = current_setting('app.user_id', true)::uuid);
