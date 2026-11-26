-- Post-sale task is independent from payment and delivery status.
BEGIN;
CREATE TABLE IF NOT EXISTS dp.after_sales (
 request_id uuid PRIMARY KEY REFERENCES dp.orders(request_id),
 customer_id uuid NOT NULL REFERENCES dp.customers(id),
 review_due boolean NOT NULL DEFAULT false,
 review_requested_at timestamptz,
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
CREATE UNIQUE INDEX IF NOT EXISTS dp_after_sales_review_once ON dp.after_sales(customer_id) WHERE review_due;
CREATE OR REPLACE FUNCTION dp.enqueue_after_sale() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE delivery_count bigint := 0;
BEGIN
 IF NEW.status='delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
  -- Serialize completion counts per customer; count only completed deliveries.
  IF NEW.fulfillment->>'type'='delivery' THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.customer_id::text, 55431));
   SELECT count(*) INTO delivery_count FROM dp.orders WHERE customer_id=NEW.customer_id AND status='delivered' AND fulfillment->>'type'='delivery';
  END IF;
  INSERT INTO dp.after_sales(request_id,customer_id,due_at,review_due) VALUES(NEW.request_id,NEW.customer_id,COALESCE(NEW.delivered_at,now())+interval '30 minutes',delivery_count=3 AND NOT EXISTS(SELECT 1 FROM dp.after_sales WHERE customer_id=NEW.customer_id AND review_due))
  ON CONFLICT(request_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_enqueue_after_sale AFTER UPDATE OF status ON dp.orders FOR EACH ROW EXECUTE FUNCTION dp.enqueue_after_sale();
COMMIT;
