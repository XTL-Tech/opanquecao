-- Add operational roles and states without changing existing orders.
BEGIN;
ALTER TABLE dp.staff DROP CONSTRAINT staff_role_check;
ALTER TABLE dp.staff ADD CONSTRAINT staff_role_check CHECK (role IN ('admin','manager','attendant','kitchen','courier') AND (role <> 'admin' OR lower(email)='opedrososamuel@gmail.com'));
CREATE UNIQUE INDEX IF NOT EXISTS dp_one_superadmin ON dp.staff(role) WHERE role='admin';
-- Keep existing manager active during compatibility deployment. Elevation: 012, AFTER new code is verified.
ALTER TABLE dp.orders DROP CONSTRAINT orders_status_check;
ALTER TABLE dp.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending_customer','awaiting_acceptance','accepted','preparing','returned_to_attendant','completed','out_for_delivery','delivered','cancelled'));
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS return_reason text CHECK (length(return_reason)<=400);
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS courier_id text REFERENCES dp.staff(user_id);
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
COMMIT;
