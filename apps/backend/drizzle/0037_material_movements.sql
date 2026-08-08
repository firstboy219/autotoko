-- Stock had one direction. Materials arrived and current_stock went up; nothing
-- ever brought it down again for a parcel that shipped. The only code that
-- subtracted anything, bom.deductForOrder, is reachable from a marketplace
-- webhook that legal approval has not cleared, and it wrote bom_items.current_stock
-- -- the per-product column the catalogue replaced and the BOM page no longer
-- reads once a row is linked. So the number on that page could only ever grow.
--
-- Consumption cannot be a bare UPDATE. A packer fixes a mis-mapped product,
-- changes a quantity, deletes a line the scan invented; each of those has to put
-- back exactly what it took, and no reconstruction after the fact can be trusted
-- to get that right. Every movement is a row, and the stock is the sum of them.

CREATE TABLE IF NOT EXISTS material_movements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id     uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,

    -- Signed, in the MATERIAL's own unit. Positive arrived, negative shipped.
    quantity        numeric(14, 3) NOT NULL,

    -- purchase | delivery | resi_scan | adjustment | reversal
    reason          varchar(24) NOT NULL,

    -- What caused it, so a movement can be found from the thing it came from
    -- and reversed when that thing changes. resi_scan_items.id for a shipment.
    ref_table       varchar(32),
    ref_id          uuid,

    -- Free text for the audit trail: which product, how many, at what recipe
    -- quantity. Worth keeping because a recipe changes and the movement it
    -- produced should still explain itself.
    note            text,

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS material_movements_user_idx     ON material_movements (user_id);
CREATE INDEX IF NOT EXISTS material_movements_material_idx ON material_movements (material_id, created_at DESC);

-- The lookup that makes reversal cheap: "everything this scan line took".
CREATE INDEX IF NOT EXISTS material_movements_ref_idx      ON material_movements (ref_table, ref_id);

ALTER TABLE material_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON material_movements;
CREATE POLICY tenant_isolation ON material_movements
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );

-- The delivery lines already recorded arrived before this table existed. Seed
-- them so the ledger explains the whole of current_stock rather than only what
-- happens from today, otherwise the sum of movements disagrees with the number
-- on the page and there is no way to tell which one is lying.
INSERT INTO material_movements (user_id, material_id, quantity, reason, ref_table, ref_id, note, created_at)
SELECT i.user_id,
       i.material_id,
       i.quantity,
       CASE WHEN p.source = 'delivery_scan' THEN 'delivery' ELSE 'purchase' END,
       'material_purchase_items',
       i.id,
       'Dicatat sebelum buku besar stok ada',
       p.created_at
FROM material_purchase_items i
JOIN material_purchases p ON p.id = i.purchase_id
WHERE NOT EXISTS (
    SELECT 1 FROM material_movements m
    WHERE m.ref_table = 'material_purchase_items' AND m.ref_id = i.id
);

-- Which unit the packer actually typed, beside the converted figure.
--
-- content_per_pcs is stored in the material's unit, which is the only thing
-- stock can move by. But "1" against a catalogue in grams reads as either a
-- 1 gram sachet or a mis-entered 1 kg jug, and after the fact nobody can tell.
-- Keeping what was typed makes a bad entry findable.
ALTER TABLE material_purchase_items
    ADD COLUMN IF NOT EXISTS entered_content numeric(14, 3);
ALTER TABLE material_purchase_items
    ADD COLUMN IF NOT EXISTS entered_unit varchar(32);
