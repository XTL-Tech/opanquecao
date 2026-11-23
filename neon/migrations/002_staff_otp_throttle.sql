-- Disk Panquecão: limite de solicitação de código de acesso por colaborador.
-- Migração aditiva, sem expor credenciais ou abrir cadastro público.
ALTER TABLE dp.staff ADD COLUMN IF NOT EXISTS otp_requested_at timestamptz;
COMMENT ON COLUMN dp.staff.otp_requested_at IS 'Última solicitação de OTP para reduzir spam e preservar limites do Neon Auth';

-- Isola Pix, cartão e checkout combinado sem alterar pedidos/caixa.
ALTER TABLE dp.asaas_sandbox ADD COLUMN IF NOT EXISTS scenario text NOT NULL DEFAULT 'both' CHECK (scenario IN ('pix','credit_card','both'));
