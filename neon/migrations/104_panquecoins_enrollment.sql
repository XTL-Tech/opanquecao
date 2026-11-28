BEGIN;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS loyalty_terms_at timestamptz;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS phone_verified_by text REFERENCES dp.staff(user_id);
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS phone_challenge_hash text;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS phone_challenge_at timestamptz;
COMMIT;
