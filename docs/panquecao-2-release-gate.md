# Panquecão 2.0 — gate de lançamento
A publicação está autorizada pelo responsável, condicionada à homologação previamente acordada. Não fazer merge ou apontar alias oficial antes dos gates.
- Portar somente layout aprovado do preview; nunca publicar seu modo simulado, noindex global ou checkout que não envia pedidos.
- Validar regressão completa e navegador em desktop/mobile, depois checkout real em HML isolada sem clientes reais.
- Confirmar configuração de horário, catálogo, taxas, consentimento, Telegram e pedidos sem duplicidade. Migrações 004–014 exigem execução ordenada e teste com dados sintéticos; promoção superadmin separada conforme runbook.
- Configurar Auth exclusivo de clientes, OTP, Turnstile e sessão; nunca habilitar auto cadastro no Auth da equipe. PanqueCoins permanece desativado até vincular identidade e aprovar regras.
- Validar fotografias/licenças, links turísticos e atualização do sitemap/llms; retirar noindex somente da página turística definitiva após aprovação.
- Confirmar anúncio de patrocinadores e regras de contrato. Não vender vagas duplicadas.
- Antes do deploy: snapshot/backup, referência do deployment anterior, verificação de capacidade e plano de rollback. Não aplicar restauração de banco sem revisão de pedidos posteriores.
- Após deploy: smoke test, disponibilidade, catálogo, contato, pedidos, sessão, logs sem PII, reversão imediata diante de falha crítica.
