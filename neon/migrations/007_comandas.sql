-- CPF is never stored in plaintext. HMAC key stays in the server environment.
BEGIN;
CREATE TABLE IF NOT EXISTS dp.comandas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES dp.customers(id),
 cpf_key text NOT NULL CHECK(cpf_key ~ '^[a-f0-9]{64}$'),
 cpf_suffix text NOT NULL CHECK(cpf_suffix ~ '^[0-9]{2}$'),
 table_number integer NOT NULL CHECK(table_number BETWEEN 1 AND 999),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 opened_by text NOT NULL REFERENCES dp.staff(user_id),
 opened_at timestamptz NOT NULL DEFAULT now(),
 closed_by text REFERENCES dp.staff(user_id),
 closed_at timestamptz,
 CHECK((state='open' AND closed_at IS NULL AND closed_by IS NULL) OR (state='closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS dp_comandas_open_cpf ON dp.comandas(cpf_key) WHERE state='open';
CREATE INDEX IF NOT EXISTS dp_comandas_table ON dp.comandas(table_number) WHERE state='open';
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS comanda_id uuid REFERENCES dp.comandas(id);
CREATE INDEX IF NOT EXISTS dp_orders_comanda ON dp.orders(comanda_id) WHERE comanda_id IS NOT NULL;
CREATE OR REPLACE FUNCTION dp.guard_comanda_order() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tab dp.comandas%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.comanda_id IS DISTINCT FROM OLD.comanda_id THEN RAISE EXCEPTION 'Vinculo de comanda imutavel'; END IF;
 END IF;
 IF NEW.comanda_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO tab FROM dp.comandas WHERE id=NEW.comanda_id FOR UPDATE;
 IF NOT FOUND OR tab.state<>'open' OR NEW.customer_id<>tab.customer_id OR NEW.fulfillment->>'type' IS DISTINCT FROM 'table' OR NEW.fulfillment->>'table' IS DISTINCT FROM tab.table_number::text THEN
  RAISE EXCEPTION 'Comanda fechada ou pedido incompatível';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_guard_comanda_order BEFORE INSERT OR UPDATE OF comanda_id,customer_id,fulfillment ON dp.orders FOR EACH ROW EXECUTE FUNCTION dp.guard_comanda_order();
CREATE OR REPLACE FUNCTION dp.close_comanda(p_id uuid,p_actor text) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tab dp.comandas%ROWTYPE;
BEGIN
 SELECT * INTO tab FROM dp.comandas WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR tab.state<>'open' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM dp.staff WHERE user_id=p_actor AND active AND role IN ('admin','manager','attendant')) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM dp.orders WHERE comanda_id=p_id AND NOT(status='cancelled' OR (status='delivered' AND payment_status='paid'))) THEN RETURN NULL; END IF;
 UPDATE dp.comandas SET state='closed',closed_by=p_actor,closed_at=now() WHERE id=p_id;
 RETURN p_id;
END $$;
COMMIT;
