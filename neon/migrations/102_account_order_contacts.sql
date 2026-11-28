-- Executar depois de 100 e 101 no banco isolado.
BEGIN;
ALTER TABLE dp.customers ADD COLUMN IF NOT EXISTS account_subject text REFERENCES dp.customer_accounts(subject) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dp_customers_account_subject_unique ON dp.customers(account_subject);
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS contact_phone text;
COMMIT;
