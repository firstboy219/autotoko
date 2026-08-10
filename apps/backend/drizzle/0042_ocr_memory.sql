-- What the camera read, and what a person said it was.
--
-- Similarity matching can get "Reralus Swak Spey Mih" to "Mouthspray Siwak";
-- it will never get "Bagels Gyreani He" to "Inhaler Regular Peppermint". That
-- pair is real -- it is in resi_scan_items right now -- and the only thing that
-- can ever resolve it is having seen it before.
--
-- So this is a memory rather than a model: the exact reading, normalised, and
-- the answer a person gave. The same label photographed the same way tomorrow
-- produces nearly the same garbage, and garbage that has been answered once is
-- answered instantly.

CREATE TABLE IF NOT EXISTS ocr_corrections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- product | material. Kept general so shop and courier can join later
    -- without another table.
    kind        varchar(16) NOT NULL,

    -- Lower case, alphanumerics and single spaces. The raw text is kept beside
    -- it because a normalised key cannot be read back by a person wondering
    -- why a guess came out the way it did.
    raw_norm    varchar(255) NOT NULL,
    raw_text    text,

    -- master_products.id or materials.id, per kind. Deliberately no foreign
    -- key: a deleted product should not take its lesson with it silently, and
    -- the join that reads this filters to live rows anyway.
    target_id   uuid NOT NULL,

    -- How many times a person has answered this reading this way. A reading
    -- answered twice beats one answered once, which is what makes a mistaken
    -- correction recoverable by simply correcting it again.
    hits        integer NOT NULL DEFAULT 1,

    last_seen   timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- One row per reading per answer; repeats increment hits instead.
    CONSTRAINT ocr_corrections_unique UNIQUE (user_id, kind, raw_norm, target_id)
);

CREATE INDEX IF NOT EXISTS ocr_corrections_lookup_idx
    ON ocr_corrections (user_id, kind, hits DESC);

ALTER TABLE ocr_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ocr_corrections;
CREATE POLICY tenant_isolation ON ocr_corrections
    USING (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.bypass', true) = 'on'
    );

-- Seed from the corrections already made. Five pairs exist and one of them is
-- the case that motivates the whole table.
SET app.bypass = 'on';

INSERT INTO ocr_corrections (user_id, kind, raw_norm, raw_text, target_id, hits, last_seen)
SELECT s.user_id,
       'product',
       left(regexp_replace(lower(i.raw_name), '[^a-z0-9]+', ' ', 'g'), 255),
       i.raw_name,
       i.master_product_id,
       count(*),
       max(i.created_at)
FROM resi_scan_items i
JOIN resi_scans s ON s.id = i.resi_scan_id
WHERE i.raw_name IS NOT NULL
  AND i.master_product_id IS NOT NULL
  AND length(trim(regexp_replace(lower(i.raw_name), '[^a-z0-9]+', ' ', 'g'))) >= 4
GROUP BY s.user_id, i.raw_name, i.master_product_id
ON CONFLICT (user_id, kind, raw_norm, target_id)
DO UPDATE SET hits = ocr_corrections.hits + EXCLUDED.hits,
              last_seen = greatest(ocr_corrections.last_seen, EXCLUDED.last_seen);

SELECT 'pelajaran awal tersimpan: ' || count(*) FROM ocr_corrections;

RESET app.bypass;
