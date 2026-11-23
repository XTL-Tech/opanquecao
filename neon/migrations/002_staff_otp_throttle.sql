-- Disk Panquecão: limite de solicitação de código de acesso por colaborador.
-- Migração aditiva, sem expor credenciais ou abrir cadastro público.
ALTER TABLE dp.staff ADD COLUMN IF NOT EXISTS otp_requested_at timestamptz;
COMMENT ON COLUMN dp.staff.otp_requested_at IS 'Última solicitação de OTP para reduzir spam e preservar limites do Neon Auth';
