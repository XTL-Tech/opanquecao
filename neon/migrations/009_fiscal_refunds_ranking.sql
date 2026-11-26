-- Foundations only: no external fiscal emission, payment or prize distribution.
BEGIN;
CREATE TABLE IF NOT EXISTS dp.fiscal_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid REFERENCES dp.orders(request_id),
 comanda_id uuid REFERENCES dp.comandas(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','authorized','rejected','uncertain','cancelled')),
 access_key text UNIQUE CHECK(access_key ~ '^[0-9]{44}$'),
 protocol text,
 created_by text NOT NULL REFERENCES dp.staff(user_id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(request_id,comanda_id)=1),
 CHECK(state NOT IN ('authorized','cancelled') OR (access_key IS NOT NULL AND protocol IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS dp_fiscal_order_once ON dp.fiscal_documents(request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dp_fiscal_comanda_once ON dp.fiscal_documents(comanda_id) WHERE comanda_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS dp.pix_refund_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES dp.orders(request_id),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 400),
 state text NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','approved','processing','confirmed','rejected','uncertain')),
 requested_by text NOT NULL REFERENCES dp.staff(user_id),
 approved_by text REFERENCES dp.staff(user_id),
 provider_ref text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 CHECK(state<>'confirmed' OR (provider_ref IS NOT NULL AND confirmed_at IS NOT NULL AND approved_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS dp_pix_refunds_order ON dp.pix_refund_requests(request_id,state);
CREATE OR REPLACE FUNCTION dp.request_pix_refund(p_order uuid,p_amount integer,p_reason text,p_actor text)
RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ord dp.orders%ROWTYPE; reserved bigint; rid uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dp.staff WHERE user_id=p_actor AND active AND role IN ('admin','manager','attendant')) THEN RETURN NULL;END IF;
 SELECT * INTO ord FROM dp.orders WHERE request_id=p_order FOR UPDATE;
 IF NOT FOUND OR ord.payment_status<>'paid' OR ord.payment_method IS DISTINCT FROM 'pix' THEN RETURN NULL;END IF;
 SELECT coalesce(sum(amount_cents),0) INTO reserved FROM dp.pix_refund_requests WHERE request_id=p_order AND state<>'rejected';
 IF p_amount<=0 OR p_amount+reserved>ord.subtotal_cents+coalesce(ord.delivery_fee_cents,0) THEN RETURN NULL;END IF;
 INSERT INTO dp.pix_refund_requests(request_id,amount_cents,reason,requested_by) VALUES(p_order,p_amount,p_reason,p_actor) RETURNING id INTO rid;
 RETURN rid;
END $$;
CREATE TABLE IF NOT EXISTS dp.ranking_campaigns (
 year integer PRIMARY KEY CHECK(year BETWEEN 2026 AND 2100),
 starts_on date NOT NULL, ends_on date NOT NULL,
 published boolean NOT NULL DEFAULT false,
 CHECK(starts_on>=make_date(year,1,1) AND ends_on<=make_date(year,12,31) AND starts_on<=ends_on)
);
INSERT INTO dp.ranking_campaigns(year,starts_on,ends_on) VALUES(2027,'2027-01-01','2027-12-31') ON CONFLICT(year) DO NOTHING;
CREATE TABLE IF NOT EXISTS dp.ranking_participants (
 year integer NOT NULL REFERENCES dp.ranking_campaigns(year),
 customer_id uuid NOT NULL REFERENCES dp.customers(id),
 public_alias text NOT NULL CHECK(public_alias ~ '^Panque [A-F0-9]{10}$'),
 consented_at timestamptz NOT NULL DEFAULT now(),
 consent_version text NOT NULL,
 recorded_by text NOT NULL REFERENCES dp.staff(user_id),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(year,customer_id), UNIQUE(year,public_alias)
);
COMMIT;
