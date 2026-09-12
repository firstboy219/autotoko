-- Everything else the shipping label carries.
--
-- Read off four real photographs from the warehouse: besides the waybill and
-- the product table we already kept, a J&T/Tokopedia label prints the sending
-- shop and its city, the recipient's area and street address, the service
-- level (ECO/EZ), the weight, whether it is COD, the courier's sortation code,
-- the marketplace order id and package id, the buyer's nickname, the total
-- quantity and the ship date.
--
-- Nullable throughout and additive only. OCR fills what it can — which on the
-- photographs we actually get is not much — and the operator fills the rest by
-- hand, so every field has to be able to sit empty indefinitely.

ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_sender_name" varchar(160);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_sender_area" varchar(160);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_recipient_area" varchar(200);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_recipient_address" varchar(400);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_service" varchar(32);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_weight_kg" numeric(10,3);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_cod" boolean;
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_sort_code" varchar(48);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_package_id" varchar(64);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_buyer_nickname" varchar(120);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_qty_total" numeric(10,2);
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_ship_date" varchar(32);

-- Set the moment a human corrects any of the fields above. A re-read of the
-- photo must never overwrite a corrected value with a worse guess, and this is
-- the flag that stops it.
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "label_edited_at" timestamp with time zone;

-- How the reading went, so the page can say "check this" instead of presenting
-- a 40%-confidence guess with the same authority as a typed-in fact.
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "ocr_confidence" numeric(5,2);
