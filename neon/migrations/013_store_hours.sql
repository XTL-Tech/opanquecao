BEGIN;
CREATE TABLE IF NOT EXISTS dp.store_operations (
 restaurant_id text PRIMARY KEY CHECK(restaurant_id='opanquecao'),
 time_zone text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK(time_zone='America/Sao_Paulo'),
 accepting_orders boolean NOT NULL DEFAULT false,
 enforce_opening_hours boolean NOT NULL DEFAULT true CHECK(enforce_opening_hours),
 weekly_schedule jsonb NOT NULL CHECK(jsonb_typeof(weekly_schedule)='object'),
 holiday_exceptions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(holiday_exceptions)='object'),
 manual_state text NOT NULL DEFAULT 'auto' CHECK(manual_state IN ('auto','open','closed')),
 manual_override_until timestamptz,
 updated_by text NOT NULL REFERENCES dp.staff(user_id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((manual_state='auto' AND manual_override_until IS NULL) OR (manual_state<>'auto' AND manual_override_until IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS dp.store_operation_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id text NOT NULL REFERENCES dp.staff(user_id),
 previous_state jsonb,
 next_state jsonb NOT NULL,
 happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION dp.audit_store_operation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 INSERT INTO dp.store_operation_events(actor_id,previous_state,next_state)
 VALUES(NEW.updated_by,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER dp_store_operation_audit AFTER INSERT OR UPDATE ON dp.store_operations FOR EACH ROW EXECUTE FUNCTION dp.audit_store_operation();
-- Deliberately no default schedule: obtain the actual opening hours from the owners.
COMMIT;
