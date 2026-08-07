-- Extra pages of one waybill.
--
-- Some orders print across two or three sheets: the courier's own label, then
-- a continuation carrying the rest of the product table. They all share one
-- waybill number, so the scanner's duplicate guard — correctly — refuses the
-- second sheet as an already-scanned parcel, and the pages that hold half the
-- products were simply never photographed.
--
-- The first photo stays on resi_scans.photo_url. Moving it here would rewrite
-- every read path for no gain; a scan with one page is still the ordinary
-- case, and this table is empty for it.
CREATE TABLE IF NOT EXISTS "resi_scan_photos" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "resi_scan_id" uuid NOT NULL REFERENCES "resi_scans"("id") ON DELETE CASCADE,
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "photo_url"    varchar(255) NOT NULL,
  -- 2 for the first extra sheet: page 1 is the photo on resi_scans itself.
  "page_no"      integer NOT NULL DEFAULT 2,
  "device_text"  text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "resi_scan_photos_scan_idx" ON "resi_scan_photos" ("resi_scan_id");
