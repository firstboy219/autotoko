-- The order screenshot, kept apart from the waybill photo.
--
-- receipt_url already holds the parcel's label: what arrived. This holds what
-- was ordered — the marketplace's order detail, which is where the quantities
-- and the money actually are. A courier label carries neither.
--
-- Two columns rather than one because they answer different questions and are
-- taken at different moments: the label is photographed at the bench when the
-- box lands, the order screenshot comes from whoever placed the order, often
-- days earlier and from a different phone.
ALTER TABLE material_purchases
    ADD COLUMN IF NOT EXISTS order_photo_url text;
