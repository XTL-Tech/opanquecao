BEGIN;
CREATE TABLE IF NOT EXISTS dp.ad_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 advertiser text NOT NULL CHECK(length(advertiser) BETWEEN 2 AND 80),
 contact text NOT NULL DEFAULT '' CHECK(length(contact)<=160),
 contract_ref text NOT NULL DEFAULT '' CHECK(length(contract_ref)<=120),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=500),
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 due_on date NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 0 AND 10000000),
 paid_cents integer NOT NULL DEFAULT 0 CHECK(paid_cents BETWEEN 0 AND amount_cents),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','paused','ended')),
 headline text NOT NULL CHECK(length(headline) BETWEEN 2 AND 100),
 description text NOT NULL CHECK(length(description)<=240),
 destination text NOT NULL DEFAULT '',
 media_path text NOT NULL DEFAULT '',
 seconds integer NOT NULL DEFAULT 15 CHECK(seconds BETWEEN 5 AND 60),
 show_tv boolean NOT NULL DEFAULT true,
 show_checkout boolean NOT NULL DEFAULT false,
 created_by text NOT NULL REFERENCES dp.staff(user_id),
 updated_by text NOT NULL REFERENCES dp.staff(user_id),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state<>'active' OR length(trim(contract_ref))>0)
);
CREATE INDEX IF NOT EXISTS dp_ad_contracts_schedule ON dp.ad_contracts(state,starts_on,ends_on);
CREATE TABLE IF NOT EXISTS dp.ad_contract_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 contract_id uuid NOT NULL REFERENCES dp.ad_contracts(id),
 actor_id text NOT NULL REFERENCES dp.staff(user_id),
 previous_state jsonb,
 next_state jsonb NOT NULL,
 happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION dp.audit_ad_contract() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 INSERT INTO dp.ad_contract_events(contract_id,actor_id,previous_state,next_state)
 VALUES(NEW.id,NEW.updated_by,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER dp_ad_contract_audit AFTER INSERT OR UPDATE ON dp.ad_contracts FOR EACH ROW EXECUTE FUNCTION dp.audit_ad_contract();
COMMIT;
