-- Cashback foundation: disabled until redemption and reconciliation are homologated.
BEGIN;
CREATE TABLE IF NOT EXISTS dp.cashback_config (
 id text PRIMARY KEY CHECK(id='opanquecao'),
 enabled boolean NOT NULL DEFAULT false,
 enabled_at timestamptz,
 CHECK(NOT enabled OR enabled_at IS NOT NULL)
);
INSERT INTO dp.cashback_config(id) VALUES('opanquecao') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS dp.cashback_credits (
 request_id uuid PRIMARY KEY REFERENCES dp.orders(request_id),
 customer_id uuid NOT NULL REFERENCES dp.customers(id),
 eligible_order_number bigint NOT NULL CHECK(eligible_order_number>=2),
 base_cents integer NOT NULL CHECK(base_cents>=0),
 credit_cents integer NOT NULL CHECK(credit_cents>=0 AND credit_cents<=base_cents),
 earned_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>earned_at),
 CHECK(credit_cents=(base_cents/10))
);
CREATE INDEX IF NOT EXISTS dp_cashback_customer_expiry ON dp.cashback_credits(customer_id,expires_at);
CREATE OR REPLACE FUNCTION dp.accrue_cashback() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE cfg dp.cashback_config%ROWTYPE; n bigint; ts timestamptz; expiry timestamptz;
BEGIN
 IF NEW.status<>'delivered' OR NEW.payment_status<>'paid' THEN RETURN NEW; END IF;
 IF OLD.status='delivered' AND OLD.payment_status='paid' THEN RETURN NEW; END IF;
 SELECT * INTO cfg FROM dp.cashback_config WHERE id='opanquecao' AND enabled;
 IF NOT FOUND THEN RETURN NEW; END IF;
 ts:=clock_timestamp();
 IF ts<cfg.enabled_at OR NEW.created_at<cfg.enabled_at THEN RETURN NEW; END IF;
 -- Same customer lock used by post-sale counting; prevent concurrent awards.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.customer_id::text,55431));
 SELECT count(*) INTO n FROM dp.orders WHERE customer_id=NEW.customer_id AND status='delivered' AND payment_status='paid';
 IF n<2 OR NEW.subtotal_cents<10 THEN RETURN NEW; END IF;
 expiry:=(date_trunc('month',ts AT TIME ZONE 'America/Sao_Paulo')+interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
 INSERT INTO dp.cashback_credits(request_id,customer_id,eligible_order_number,base_cents,credit_cents,earned_at,expires_at)
 VALUES(NEW.request_id,NEW.customer_id,n,NEW.subtotal_cents,NEW.subtotal_cents/10,ts,expiry)
 ON CONFLICT(request_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_accrue_cashback AFTER UPDATE OF status,payment_status ON dp.orders FOR EACH ROW EXECUTE FUNCTION dp.accrue_cashback();
COMMIT;
