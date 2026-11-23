-- Controles de reconciliação manual para tentativas Asaas Sandbox sem resposta conclusiva.
-- Não apaga evidências nem marca cobranças reais como pagas/canceladas.
ALTER TABLE dp.asaas_sandbox ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE dp.asaas_sandbox ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE dp.asaas_sandbox ADD COLUMN IF NOT EXISTS review_note text;
COMMENT ON COLUMN dp.asaas_sandbox.reviewed_at IS 'Gestor conferiu a ausência do checkout no painel Asaas Sandbox antes de tentar novamente';
