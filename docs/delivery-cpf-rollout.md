# O Panquecão — backoffice Lite e pedidos digitais (issue #62)

Estado: implementação em branch isolada, NÃO homologada para produção.

## Entrega
- Cadastro delivery por OTP de e-mail já existente, CPF validado, HMAC exclusivo, índice único, conta e endereços persistentes. Pedidos associados ao subject autenticado, contato histórico salvo separadamente. CPF e telefone não são comprovados como pertencentes ao titular.
- Modo DIGITAL_ORDERS_ENABLED: registro no banco antes de notificar Telegram, mensagem textual em vez de PDF, aceite/rejeição autorizados e condicionais; fallback operacional no painel. Rota antiga /api/order bloqueada. Nenhuma aprovação automática.
- /local: página web responsiva usando o catálogo comum, mesa obrigatória, sem frete, CPF ou telefone, carrinho em memória e comprovante/status na mesma sessão. Sem PWA instalável ou funcionamento offline homologado.
- Painel Lite: somente administração (admin/manager existentes), pedidos, filtro de canal, clientes, busca CPF via POST/HMAC, histórico, preços, horários. Visualização GPS privada sem mapa-base e links individuais de mapa para endereços. Não rastreia clientes. Legado preservado para rollback.
- Horário obrigatório no servidor com abertura/fechamento manual e agenda semanal. Override existente expira de 5 minutos a 24h; mudança de horário não altera pedidos aceitos.
- Tarifas em delivery-areas.json: Nova Hartz e Araricá R$10 padrão; exceções Araricá R$15/R$20; Parobé e Sapiranga R$35 mediante cobertura e Pix recebido antes de preparar. Demais locais não cadastrados exigem revisão. Subtotal, frete e total recalculados/registrados pelo servidor; retirada e mesa sem frete. Não usar cobrança real nesta fase.

## Gate
1. CI completa: npm ci, npm test, testes de conta e retenção, cache e Chromium. Testes específicos CPF, texto digital, autorização e modalidades passaram no SHA c6c5a018; CI integral anterior falhou. Correções de regex do cabeçalho, runner Ubuntu 24.04, cache, inicialização de tarifas e sessão foram feitas depois; repetir CI no HEAD.
2. Confirmar schema anterior de customer_accounts e migrações existentes, backup e restore. Aplicar somente em banco de homologação migrations 100, 101, 102 em ordem. Não executar em produção automaticamente. Verificar concorrência, triggers de estados, isolamento de contas e rollback.
3. Validar uso de Neon dedicado, autenticação separada, Turnstile, Telegram e webhook com chat de teste, origem e segredos exclusivos. CUSTOMER_CPF_HMAC_KEY 32 bytes aleatórios em hex; nunca expor. O modo digital bloqueia gravação em preview; homologar runtime isolado com configuração explícita antes de publicar.
4. Configurar catálogo e horários no Neon; STORE_HOURS_MODE=required, STORE_HOURS_SOURCE=neon, CATALOG_SOURCE=neon, CUSTOMER_ACCOUNTS_ENABLED=true, DELIVERY_ACCOUNT_REQUIRED=true, DIGITAL_ORDERS_ENABLED=true apenas após gate.
5. Validar tarifa e Pix prévio, cancelamento, recuperação de CPF, LGPD, verificação de telefone se exigida, estados no Telegram e navegador real. A busca de CPF não expõe CPF completo. Fidelidade não ativada.
6. Confirmar política comercial e divergências do branch main vs runtime comercial. Não publicar, mesclar ou executar migrações reais sem homologação. Rollback: desligar flags e manter migrations aditivas, registros e histórico. Não contratar serviços pagos.

## Limitações atuais
Mapa-base integrado, PWA instalável, programa de fidelidade, alertas automáticos de status e recuperação/correção de CPF não foram homologados ou concluídos. Entregas remotas exigem confirmação de cobertura e registro manual do Pix. Não declarar pronto para produção.
