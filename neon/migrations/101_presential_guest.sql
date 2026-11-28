-- Migration aditiva: convidado presencial sem telefone inventado. Aplicar em HML.
BEGIN;
ALTER TABLE dp.customers ALTER COLUMN phone DROP NOT NULL;
COMMIT;
