BEGIN;
CREATE TABLE IF NOT EXISTS dp.catalog_availability_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 category text NOT NULL, product text NOT NULL,
 previous_available boolean NOT NULL, available boolean NOT NULL,
 actor_id text NOT NULL REFERENCES dp.staff(user_id),
 changed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON dp.catalog_availability_events FROM PUBLIC;
COMMIT;
