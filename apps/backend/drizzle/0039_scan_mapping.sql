-- A scan knew what was in the parcel and nothing about where it came from.
--
-- The label carries the shop, the marketplace and the courier, and the parser
-- already reads all three -- into label_marketplace, label_sender_name and
-- courier. Those are readings, not decisions: free text from a photograph, with
-- no link to the shops table, so nothing could group a day's scans by shop or
-- say which marketplace they came from. Every question the dashboard wants to
-- ask starts there.
--
-- Kept SEPARATE from the label_* columns for the same reason resi_scan_items
-- keeps raw_name beside master_product_id: when a mapping turns out wrong, the
-- text the machine was looking at is the only way to see why.

ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES shops(id) ON DELETE SET NULL;

-- Confirmed, not read. A shop implies its marketplace, so this is redundant
-- whenever shop_id is set -- and it is not redundant when the shop is one the
-- seller has not registered, which on a marketplace they sell through by hand
-- is most of them.
ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS marketplace varchar(24);

-- The courier column above is what the barcode and OCR suggested. This is what
-- a person says it is.
ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS courier_confirmed varchar(32);

-- Separate from items_confirmed_at on purpose.
--
-- "Somebody checked the contents" and "somebody said which shop this is" are
-- different statements and get answered at different times: the packer does the
-- first at the bench, and the second may need a person who knows which of four
-- Shopee accounts a label belongs to. One flag for both would let either
-- silently stand in for the other.
ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS mapping_confirmed_at timestamptz;
ALTER TABLE resi_scans
    ADD COLUMN IF NOT EXISTS mapping_confirmed_by varchar(64);

-- The pending-task list reads exactly this: scans still missing an answer.
-- Partial, so it stays small as the confirmed ones pile up behind it.
CREATE INDEX IF NOT EXISTS resi_scans_unmapped_idx
    ON resi_scans (user_id, scanned_at DESC)
    WHERE mapping_confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS resi_scans_shop_idx
    ON resi_scans (user_id, shop_id, scanned_at DESC);

-- Deliberately NO backfill.
--
-- 0038 backfilled items_confirmed_at because marking months of finished work as
-- outstanding would have buried the scans that really were outstanding. This is
-- the opposite case: no scan has ever had a shop, so every one of them
-- genuinely is unmapped, and pretending otherwise would empty the pending-task
-- list of the very thing it was built to show.
