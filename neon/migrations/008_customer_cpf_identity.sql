-- CPF identity belongs to the customer, not to a visit or telephone.
BEGIN;
ALTER TABLE dp.customers ADD COLUMN IF NOT EXISTS cpf_key text CHECK(cpf_key ~ '^[a-f0-9]{64}$');
ALTER TABLE dp.customers ADD COLUMN IF NOT EXISTS cpf_suffix text CHECK(cpf_suffix ~ '^[0-9]{2}$');
ALTER TABLE dp.customers ADD COLUMN IF NOT EXISTS cpf_linked_at timestamptz;
ALTER TABLE dp.customers ADD COLUMN IF NOT EXISTS cpf_linked_by text REFERENCES dp.staff(user_id);
ALTER TABLE dp.customers ADD CONSTRAINT customers_cpf_pair CHECK((cpf_key IS NULL AND cpf_suffix IS NULL AND cpf_linked_at IS NULL AND cpf_linked_by IS NULL) OR (cpf_key IS NOT NULL AND cpf_suffix IS NOT NULL AND cpf_linked_at IS NOT NULL AND cpf_linked_by IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS dp_customers_cpf_unique ON dp.customers(cpf_key) WHERE cpf_key IS NOT NULL;
CREATE OR REPLACE FUNCTION dp.open_customer_comanda(p_key text,p_suffix text,p_table integer,p_name text,p_phone text,p_actor text,p_confirm_existing boolean)
RETURNS TABLE(tab_id uuid,customer_name text,table_number integer,cpf_suffix text) LANGUAGE plpgsql SET search_path='' AS $$
DECLARE cust dp.customers%ROWTYPE; tab dp.comandas%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dp.staff WHERE user_id=p_actor AND active AND role IN ('admin','manager','attendant')) THEN RETURN; END IF;
 IF p_key !~ '^[a-f0-9]{64}$' OR p_suffix !~ '^[0-9]{2}$' OR p_table NOT BETWEEN 1 AND 999 THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key,55432));
 SELECT * INTO cust FROM dp.customers WHERE cpf_key=p_key FOR UPDATE;
 IF NOT FOUND THEN
  IF p_name IS NULL OR p_phone IS NULL THEN RETURN; END IF;
  -- Existing phone is linked only after operator confirmation and matching name.
  INSERT INTO dp.customers AS cc(name,phone,cpf_key,cpf_suffix,cpf_linked_at,cpf_linked_by)
  VALUES(p_name,p_phone,p_key,p_suffix,now(),p_actor)
  ON CONFLICT(phone) DO UPDATE SET cpf_key=excluded.cpf_key,cpf_suffix=excluded.cpf_suffix,cpf_linked_at=now(),cpf_linked_by=p_actor
   WHERE cc.cpf_key IS NULL AND p_confirm_existing AND lower(trim(cc.name))=lower(trim(p_name))
  RETURNING cc.* INTO cust;
  IF NOT FOUND THEN RETURN; END IF;
 END IF;
 SELECT * INTO tab FROM dp.comandas WHERE cpf_key=p_key AND state='open' FOR UPDATE;
 IF FOUND THEN
  IF tab.customer_id<>cust.id OR tab.table_number<>p_table THEN RETURN; END IF;
 ELSE
  INSERT INTO dp.comandas(customer_id,cpf_key,cpf_suffix,table_number,opened_by)
  VALUES(cust.id,p_key,cust.cpf_suffix,p_table,p_actor) RETURNING * INTO tab;
 END IF;
 RETURN QUERY SELECT tab.id,cust.name,tab.table_number,cust.cpf_suffix;
END $$;
CREATE OR REPLACE FUNCTION dp.check_comanda_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dp.customers WHERE id=NEW.customer_id AND cpf_key=NEW.cpf_key AND cpf_suffix=NEW.cpf_suffix) THEN
  RAISE EXCEPTION 'CPF da comanda não corresponde ao cadastro';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_check_comanda_identity BEFORE INSERT OR UPDATE OF customer_id,cpf_key,cpf_suffix ON dp.comandas FOR EACH ROW EXECUTE FUNCTION dp.check_comanda_identity();
-- Program remains disabled. Only identified customers are eligible for future issuance.
CREATE OR REPLACE FUNCTION dp.accrue_cashback() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE cfg dp.cashback_config%ROWTYPE; n bigint; ts timestamptz; expiry timestamptz;
BEGIN
 IF NEW.status<>'delivered' OR NEW.payment_status<>'paid' THEN RETURN NEW; END IF;
 IF OLD.status='delivered' AND OLD.payment_status='paid' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM dp.customers WHERE id=NEW.customer_id AND cpf_key IS NOT NULL) THEN RETURN NEW; END IF;
 SELECT * INTO cfg FROM dp.cashback_config WHERE id='opanquecao' AND enabled;
 IF NOT FOUND THEN RETURN NEW; END IF;
 ts:=clock_timestamp();
 IF ts<cfg.enabled_at OR NEW.created_at<cfg.enabled_at THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.customer_id::text,55431));
 SELECT count(*) INTO n FROM dp.orders WHERE customer_id=NEW.customer_id AND status='delivered' AND payment_status='paid';
 IF n<2 OR NEW.subtotal_cents<10 THEN RETURN NEW; END IF;
 expiry:=(date_trunc('month',ts AT TIME ZONE 'America/Sao_Paulo')+interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
 INSERT INTO dp.cashback_credits(request_id,customer_id,eligible_order_number,base_cents,credit_cents,earned_at,expires_at)
 VALUES(NEW.request_id,NEW.customer_id,n,NEW.subtotal_cents,NEW.subtotal_cents/10,ts,expiry)
 ON CONFLICT(request_id) DO NOTHING;
 RETURN NEW;
END $$;
COMMIT;
