-- One barcode is not a parcel's identity.
--
-- An SPX label carries the waybill and at least two other codes. Whichever
-- happened to be in frame became the resi, so the same parcel was recorded
-- three times in 96 seconds under three different numbers -- and consumed its
-- raw materials three times over. Evidence: three scans on 9 Aug whose OCR text
-- all contains SPXID061293185184, stored as 260423JKEWN7H2, SPXID061293185184
-- and 260423JEPZ7H2.
--
-- The seller proposed keying on barcode + marketplace + courier. That does not
-- close it: the barcode component already differs between the three, and in
-- this data courier is filled on 3 of 67 scans and confirmed marketplace on 2.
-- The composite would be (barcode, null, null) for almost everything.
--
-- What does close it is remembering every code seen on a label. Two scans of
-- one parcel overlap on at least one code even when the numbers they each
-- settled on are different.

CREATE TABLE IF NOT EXISTS resi_scan_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scan_id     uuid NOT NULL REFERENCES resi_scans(id) ON DELETE CASCADE,

    -- Normalised the same way resi is: upper case, alphanumerics only.
    code        varchar(64) NOT NULL,
    format      varchar(32),

    created_at  timestamptz NOT NULL DEFAULT now()
);

-- The lookup the duplicate guard makes on every scan.
CREATE INDEX IF NOT EXISTS resi_scan_codes_lookup_idx ON resi_scan_codes (user_id, code);
CREATE INDEX IF NOT EXISTS resi_scan_codes_scan_idx   ON resi_scan_codes (scan_id);

-- Deliberately NOT a unique constraint on (user_id, code).
--
-- Not every code on a label identifies the parcel: a hub sort code or a
-- destination code is shared by every parcel going the same way that day. A
-- unique index would refuse the second real parcel of the morning and there
-- would be no way to record it at all. The guard is a lookup in application
-- code, restricted to codes long enough to be a waybill, so a false match
-- surfaces as a message the packer can read and act on rather than a constraint
-- violation they cannot.

-- Seed from what is already recorded, so the guard works against history from
-- the moment it ships rather than only against parcels scanned after it.
SET app.bypass = 'on';

INSERT INTO resi_scan_codes (user_id, scan_id, code, format, created_at)
SELECT s.user_id, s.id, s.resi, s.barcode_format, s.scanned_at
FROM resi_scans s
WHERE NOT EXISTS (
    SELECT 1 FROM resi_scan_codes c WHERE c.scan_id = s.id AND c.code = s.resi
);

RESET app.bypass;
