-- A scan had no moment of being finished with.
--
-- The contents editor saved every keystroke as it happened, which is convenient
-- and means nothing was ever declared complete. On the web that left no submit
-- button to press; on the phone it let a packer wave the camera at the next
-- parcel while the last one still held lines nobody had looked at. Both produce
-- the same thing: a scan that looks recorded and whose contents are a guess.
--
-- Null means nobody has confirmed the contents yet. Scans recorded before this
-- column existed are backfilled below rather than left null, because marking
-- months of finished work as outstanding would bury the ones that really are.
ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS items_confirmed_at timestamptz;

-- Who pressed it. A packing floor runs several phones and the question after a
-- wrong mapping is always which of them.
ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS items_confirmed_by varchar(64);

-- Through RLS this UPDATE sees nothing and reports success. Every backfill
-- in this codebase has to say so explicitly.
SET app.bypass = 'on';

UPDATE resi_scans
SET items_confirmed_at = scanned_at,
    items_confirmed_by = 'sebelum fitur konfirmasi'
WHERE items_confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS resi_scans_unconfirmed_idx
    ON resi_scans (user_id, scanned_at DESC)
    WHERE items_confirmed_at IS NULL;

RESET app.bypass;
