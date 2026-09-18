-- 0077: batch packing asinkron — kolom hasil di order_batches. Additive & idempotent.
ALTER TABLE order_batches ADD COLUMN IF NOT EXISTS resi_pdf_url varchar(255);
ALTER TABLE order_batches ADD COLUMN IF NOT EXISTS packing_list_pdf_url varchar(255);
ALTER TABLE order_batches ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE order_batches ADD COLUMN IF NOT EXISTS error_message text;
