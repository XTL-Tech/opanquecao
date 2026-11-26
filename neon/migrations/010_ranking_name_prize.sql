-- Explicit, separate permission for public display of the customer's chosen name.
BEGIN;
ALTER TABLE dp.ranking_participants ADD COLUMN IF NOT EXISTS public_name text CHECK(length(public_name) BETWEEN 2 AND 80);
ALTER TABLE dp.ranking_participants ADD COLUMN IF NOT EXISTS name_consent_at timestamptz;
ALTER TABLE dp.ranking_participants ADD CONSTRAINT ranking_name_consent CHECK((public_name IS NULL AND name_consent_at IS NULL) OR (public_name IS NOT NULL AND name_consent_at IS NOT NULL));
ALTER TABLE dp.ranking_campaigns ADD COLUMN IF NOT EXISTS prize_description text;
ALTER TABLE dp.ranking_campaigns ADD COLUMN IF NOT EXISTS authorization_reference text;
UPDATE dp.ranking_campaigns SET prize_description='Por categoria: um jantar com uma panqueca salgada, uma panqueca doce e um refrigerante.' WHERE year=2027;
ALTER TABLE dp.ranking_campaigns ADD CONSTRAINT ranking_prize_publication_guard CHECK(NOT published OR (authorization_reference IS NOT NULL AND length(trim(authorization_reference))>0 AND prize_description IS NOT NULL));
COMMIT;
