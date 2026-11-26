BEGIN;
-- Isolated public customer identity, never grants dp.staff privileges.
CREATE TABLE IF NOT EXISTS dp.customer_accounts (
 subject text PRIMARY KEY CHECK (length(subject) BETWEEN 4 AND 150),
 name text NOT NULL DEFAULT '' CHECK(length(name)<=80),
 phone text NOT NULL DEFAULT '' CHECK(phone='' OR phone ~ '^[1-9][0-9]{9,10}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dp.customer_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_subject text NOT NULL REFERENCES dp.customer_accounts(subject) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 50),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=2500),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_addresses_owner_idx ON dp.customer_addresses(owner_subject,id);
CREATE TABLE IF NOT EXISTS dp.customer_otp_limits (
 email_key text PRIMARY KEY CHECK(email_key ~ '^[a-f0-9]{64}$'),
 requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dp.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dp.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE dp.customer_otp_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dp.customer_accounts,dp.customer_addresses,dp.customer_otp_limits FROM PUBLIC;
-- No public RLS policies; only the trusted server connection accesses these tables.
COMMIT;
