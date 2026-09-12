-- What the phone read, kept apart from what the server read.
--
-- Two different engines look at the same label: ML Kit on the handset, across
-- dozens of live frames, and tesseract on the server, from one JPEG. Folding
-- them into one column would make the comparison impossible, and the
-- comparison is the point — it is the only way to tell whether reading on the
-- device is actually better here, rather than assuming it.
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "device_text" text;

-- Sharpness at the moment of capture, 0-100, as the scanner's own meter
-- reported it. A thin reading from a blurred frame is a different problem from
-- a thin reading from a sharp one, and only this tells them apart.
ALTER TABLE "resi_scans" ADD COLUMN IF NOT EXISTS "device_clarity" numeric(5,2);

-- How the phone arrived at each mapped line: matched to a master product on
-- its own, or chosen by the packer when the match was not clear enough.
ALTER TABLE "resi_scan_items" ADD COLUMN IF NOT EXISTS "source" varchar(16);

-- 0-1. How close the label's wording was to the master product's name. Kept so
-- a wrong auto-match can be found afterwards by looking at what the machine
-- thought it knew, instead of guessing.
ALTER TABLE "resi_scan_items" ADD COLUMN IF NOT EXISTS "match_score" numeric(4,3);
