# XTL FOOD Pilot 01 — runbook de liberação

## Estado
- PR 55 consolida o escopo operacional e o código do PR 54; não publicar ambos independentemente.
- HML Neon: br-dawn-moon-b62hj73r, migrações 004–011 aplicadas. O proprietário já tem role admin nesse ambiente devido à versão anterior da 004.
- Produção: catálogo Neon preservado; usuário manager e atendente atuais permanecem ativos. Não usar scripts/neon-setup.cjs para atualizar a produção nem reimportar cardapio.json.
- Nenhuma emissão fiscal, devolução Pix, PanqueCoins ou promoção comercial deve ser habilitada por esta liberação.

## Gates de homologação
1. CI da versão consolidada verde, incluindo Telegram, contratos publicitários, ranking, CPF e BI.
2. Preview isolado, com DATABASE_URL e Auth de HML verificados, sem bot/Asaas de produção; negar acesso público ao ambiente com dados copiados. Não usar credenciais reais em fixtures.
3. Testar sessão e saída, atendimento, permissões, cozinha, entrega, mesas, fechamento do caixa, histórico de preço, relatórios, TV 16:9, expiração de anúncios, falha de conexão e ausência de PII no feed público.
4. Configurar COMANDA_CPF_HMAC_KEY como segredo aleatório de 32 bytes em hexadecimal, diferente de HML. Guardar recuperação segura antes do primeiro CPF; não rotacionar sem plano de migração.
5. Antes da publicação, confirmar backup/PITR disponível e procedimento de restauração, custo e uso comercial permitido na hospedagem. Validar a impressão térmica física.
6. Planejar ativação da aprovação Telegram separadamente: mapear IDs autorizados, configurar segredo, verificar webhook existente sem sobrescrevê-lo e testar apenas em ambiente autorizado.

## Produção — somente após aprovação da janela
- Aplicar migrações 004–011 de forma controlada, sem elevar o manager durante a 004.
- Conferir catálogo/revisão, contagem de contas e integridade de pedidos antes e depois.
- Publicar a versão consolidada; validar login do proprietário ainda manager e da atendente.
- Aplicar 012 exclusivamente após confirmar compatibilidade da nova autenticação. Validar acesso integral do proprietário e restrição técnica do Asaas.
- Criar contas individuais dos donos, cozinha e motoboy apenas com identidades confirmadas.
- Verificar publicação pública do cardápio, pedidos e acessos por perfil. Não gerar cobrança ou pedido real para smoke test sem autorização.

## Rollback
Se o código antigo precisar voltar após a 012, reverter apenas a role do proprietário para manager por procedimento autorizado e auditado antes de reverter o deploy. Não apagar tabelas ou dados; manter módulos aditivos desligados e reconciliar pedidos/caixa. Depois de existirem novos status em produção, o código antigo deixa de ser rollback operacional completo: priorizar correção para frente ou plano específico de compatibilidade.

## Controle de horário (013)
Aplicar a migração 013, cadastrar a agenda semanal real com os proprietários, verificar abertura e fechamento no horário America/Sao_Paulo e só então ativar STORE_HOURS_MODE=required e STORE_HOURS_SOURCE=neon. Ausência de agenda ou falha de consulta fecha o recebimento de novos pré-pedidos. Não presumir horários. O modo visual cinza não substitui o bloqueio server-side. Não ativar sem confirmar a agenda real.
