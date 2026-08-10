-- Learning for couriers needs a target that is not a row.
--
-- A product and a material are rows with ids. A courier is one of nine names —
-- "J&T", "SPX", "JNE" — and there is no table of them; the list lives in code
-- because it is the same for every seller in the country. So the memory has to
-- be able to point at a name as well as at an id.
--
-- The keys differ per kind, and that is the part that decides whether any of
-- this works:
--
--   product   the product line as read       repeats per label design
--   material  the line on a supplier's resi  repeats per supplier
--   shop      the sender name as read        repeats for every parcel that shop sends
--   courier   the carrier token as read      "JSTPRESS" is J&T for ever
--
-- Whole-label text would have been the obvious key and the wrong one for shop
-- and courier: every parcel carries a different recipient, so a key built from
-- the whole reading never matches twice.

ALTER TABLE ocr_corrections ALTER COLUMN target_id DROP NOT NULL;

ALTER TABLE ocr_corrections
    ADD COLUMN IF NOT EXISTS target_text varchar(64);

-- One of the two must be there, or the row teaches nothing.
ALTER TABLE ocr_corrections DROP CONSTRAINT IF EXISTS ocr_corrections_has_target;
ALTER TABLE ocr_corrections
    ADD CONSTRAINT ocr_corrections_has_target
    CHECK (target_id IS NOT NULL OR target_text IS NOT NULL);

-- The old unique index counted target_id only, so two courier lessons with a
-- null id would have collided into one row.
ALTER TABLE ocr_corrections DROP CONSTRAINT IF EXISTS ocr_corrections_unique;
CREATE UNIQUE INDEX IF NOT EXISTS ocr_corrections_unique_idx
    ON ocr_corrections (
        user_id, kind, raw_norm,
        coalesce(target_id::text, ''),
        coalesce(target_text, '')
    );

-- The delivery line never kept what the resi said; recordDelivery accepted it
-- and dropped it because there was nowhere to put it. Without this the seed
-- below would fail on a column that does not exist, and the material half of
-- the memory would have nothing to learn from ever.
ALTER TABLE material_purchase_items
    ADD COLUMN IF NOT EXISTS raw_name varchar(255);

-- Seed the material side from deliveries already mapped by hand. Same rule as
-- the product seed: a reading and an answer, both present.
SET app.bypass = 'on';

INSERT INTO ocr_corrections (user_id, kind, raw_norm, raw_text, target_id, hits, last_seen)
SELECT i.user_id,
       'material',
       left(regexp_replace(lower(i.raw_name), '[^a-z0-9]+', ' ', 'g'), 255),
       i.raw_name,
       i.material_id,
       count(*),
       max(p.created_at)
FROM material_purchase_items i
JOIN material_purchases p ON p.id = i.purchase_id
WHERE i.raw_name IS NOT NULL
  AND length(trim(regexp_replace(lower(i.raw_name), '[^a-z0-9]+', ' ', 'g'))) >= 4
GROUP BY i.user_id, i.raw_name, i.material_id
ON CONFLICT DO NOTHING;

-- And the shop side from scans already mapped, keyed on the sender line.
INSERT INTO ocr_corrections (user_id, kind, raw_norm, raw_text, target_id, hits, last_seen)
SELECT s.user_id,
       'shop',
       left(regexp_replace(lower(s.label_sender_name), '[^a-z0-9]+', ' ', 'g'), 255),
       s.label_sender_name,
       s.shop_id,
       count(*),
       max(s.scanned_at)
FROM resi_scans s
WHERE s.label_sender_name IS NOT NULL
  AND s.shop_id IS NOT NULL
  AND length(trim(regexp_replace(lower(s.label_sender_name), '[^a-z0-9]+', ' ', 'g'))) >= 4
GROUP BY s.user_id, s.label_sender_name, s.shop_id
ON CONFLICT DO NOTHING;

-- And the courier side, keyed on what OCR made of the carrier name.
INSERT INTO ocr_corrections (user_id, kind, raw_norm, raw_text, target_text, hits, last_seen)
SELECT s.user_id,
       'courier',
       left(regexp_replace(lower(s.courier), '[^a-z0-9]+', ' ', 'g'), 255),
       s.courier,
       s.courier_confirmed,
       count(*),
       max(s.scanned_at)
FROM resi_scans s
WHERE s.courier IS NOT NULL
  AND s.courier_confirmed IS NOT NULL
  AND length(trim(regexp_replace(lower(s.courier), '[^a-z0-9]+', ' ', 'g'))) >= 3
GROUP BY s.user_id, s.courier, s.courier_confirmed
ON CONFLICT DO NOTHING;

SELECT kind, count(*) FROM ocr_corrections GROUP BY kind ORDER BY kind;

RESET app.bypass;
