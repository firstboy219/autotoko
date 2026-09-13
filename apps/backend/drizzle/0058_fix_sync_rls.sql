-- Memperbaiki kebijakan RLS tiga tabel sinkronisasi.
--
-- SEBAB. Kebijakan lama mengecor current_setting('app.user_id')::uuid
-- langsung. app.user_id bawaannya string kosong '', dan Postgres tetap
-- mengevaluasi cast itu meski app.bypass='on' seharusnya sudah membuat sisi
-- OR yang pertama benar -- sehingga ''::uuid melempar "invalid input syntax
-- for type uuid" dan seluruh sinkronisasi gagal sebelum satu baris pun
-- tersimpan. Tabel inti (shops, orders) tidak kena karena membungkusnya
-- dengan NULLIF(..., '') -- '' jadi NULL, dan NULL::uuid tidak melempar.
--
-- PERBAIKAN. Samakan dengan bentuk terjaga yang sudah dipakai shops/orders.
-- Hanya definisi kebijakan yang diganti; tidak ada baris data yang disentuh.

DROP POLICY IF EXISTS tenant_isolation ON marketplace_products;
CREATE POLICY tenant_isolation ON marketplace_products
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON marketplace_skus;
CREATE POLICY tenant_isolation ON marketplace_skus
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON marketplace_sync_runs;
CREATE POLICY tenant_isolation ON marketplace_sync_runs
  USING (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
