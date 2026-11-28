-- Executar somente em banco isolado após confirmar a migration de customer_accounts.
-- Não aplicar automaticamente em build/deploy. Sem CPF em texto puro.
BEGIN;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS cpf_hash text;
ALTER TABLE dp.customer_accounts ADD COLUMN IF NOT EXISTS cpf_last2 text;
ALTER TABLE dp.customer_accounts ADD CONSTRAINT customer_cpf_pair CHECK (
 (cpf_hash IS NULL AND cpf_last2 IS NULL) OR
 (cpf_hash IS NOT NULL AND cpf_last2 IS NOT NULL AND cpf_hash ~ '^[a-f0-9]{64}$' AND cpf_last2 ~ '^[0-9]{2}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS dp_customer_accounts_cpf_unique ON dp.customer_accounts(cpf_hash) WHERE cpf_hash IS NOT NULL;
ALTER TABLE dp.orders ADD COLUMN IF NOT EXISTS account_subject text REFERENCES dp.customer_accounts(subject) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS dp_orders_account_subject_idx ON dp.orders(account_subject,created_at DESC) WHERE account_subject IS NOT NULL;
COMMIT;
