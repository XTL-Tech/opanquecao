-- Post-sale task is independent from payment and delivery status.
BEGIN;
CREATE TABLE IF NOT EXISTS dp.after_sales (
 request_id uuid PRIMARY KEY REFERENCES dp.orders(request_id),
 due_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','contacted','satisfied','issue','no_response')),
 claimed_by text REFERENCES dp.staff(user_id),
 claimed_at timestamptz,
 contacted_at timestamptz,
 resolved_at timestamptz,
 updated_by text REFERENCES dp.staff(user_id),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=400),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dp_after_sales_queue ON dp.after_sales(due_at) WHERE state IN ('pending','claimed','contacted','issue');
CREATE OR REPLACE FUNCTION dp.enqueue_after_sale() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.status='delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
  INSERT INTO dp.after_sales(request_id,due_at) VALUES(NEW.request_id,COALESCE(NEW.delivered_at,now())+interval '30 minutes')
  ON CONFLICT(request_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_enqueue_after_sale AFTER UPDATE OF status ON dp.orders FOR EACH ROW EXECUTE FUNCTION dp.enqueue_after_sale();
COMMIT;
