# XTL FOOD — demonstração integrada (v0.1)
## Escopo e isolamento
URL: /xtl-food/. Mantém integralmente o cardápio, backoffice, API, pagamentos, Telegram e banco do Disk Panquecão. A demonstração usa JavaScript e dados em memória; reiniciar ou recarregar descarta a sessão. Não é um ERP de produção nem um sistema oficial de ponto.
## Módulos
Visão geral, PDV/comandas, cozinha, copa, expedição, motoboy, cobrança, caixa, fiscal, estoque, compras, cardápio/fichas, CRM/fidelidade, financeiro, BI, equipamentos, ponto, administração e integrações (19). O perfil é selecionável apenas para validar interfaces; os controles de domínio não substituem autorização real.
## Validação
npm test inclui tests/xtl-food.mjs. Fluxos fictícios: comanda → preparo → expedição → pagamento parcial/integral → fechamento; entrega atribuída → em rota → entregue; compra → estoque; nota fictícia; fila de impressão; marcação de ponto dentro/fora do perímetro simulado.
## Próximas entregas de produção
- Persistência PostgreSQL isolada por tenant/loja, migrações em branch de teste, RBAC no servidor, auditoria imutável, idempotência e concorrência.
- Comandas com múltiplos consumos, transferências e reservas; KDS em tempo real, expedição e atribuição individual de motoboys, trilha de ocorrências.
- Conciliação financeira real por webhook autenticado; estornos e divergências com aprovação; fiscal com contador, certificado e homologação oficial.
- Adaptadores de equipamento: ESC/POS, Control iD por modelo/SDK, fila local assinada e equipamento registrado. A prévia 58/80 mm não comprova compatibilidade física.
- Ponto por identidade autenticada, estabelecimento e horário de servidor, geolocalização somente no evento, precisão e exceções auditáveis; validação trabalhista antes de uso oficial.
- Estoque por unidade/lote, inventário, perdas, compra/recebimento, custos, DRE, conciliação e relatórios contábeis completos.
- Contratos versionados, políticas, backups, recuperação, testes E2E e homologação.
XTL — Feito para durar.
