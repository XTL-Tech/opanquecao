# Disk Panquecão — Matriz de homologação Asaas Sandbox

Data da auditoria: 22/11/2026 (BRT) / 23/11/2026 (UTC).
Escopo: endpoints `api/asaas-sandbox.js`, `api/asaas-sandbox-webhook.js` e persistência `dp.asaas_*`.

## Limites e ambientes

- Somente ambiente oficial Asaas Sandbox: `https://api-sandbox.asaas.com/v3`.
- O checkout hospedado deste módulo admite **PIX** e **CREDIT_CARD**, em cobrança avulsa `DETACHED`. Boleto usa a API `/v3/payments` em **outra integração**, ainda não implementada no painel; débito, split, parcelamento, recorrência e estorno também **não integram este MVP**.
- A chave e o token são variáveis Sensitive de servidor e nunca foram expostos ou exportados para os testes.
- Ambiente publicado consultado em 23/11/2026: `GET /api/backoffice?action=status` retornou **200** com `enabled:false`, `GET /api/asaas-sandbox` retornou **503** (Backoffice desativado) e `GET /api/asaas-sandbox-webhook` retornou **405** (método não permitido).
- **Nenhuma criação de checkout foi executada com a chave real nesta auditoria**: não há gestor autorizado em `dp.staff` e `BACKOFFICE_ENABLED=false`. Não afirmar que credencial ou token Asaas esteja confirmado.

## Automatizados — sem rede, credenciais ou cobrança real

Arquivo `tests/asaas-sandbox-matrix.cjs` executado em `npm test` no GitHub Actions. Verifica:
1. Checkout de R$ 5,00, opções `PIX` e `CREDIT_CARD`, `DETACHED`, callbacks e link oficial.
2. Segredo `access_token` somente no servidor e URL `api-sandbox.asaas.com`, nunca `api.asaas.com`.
3. Proteção por sessão de gestor e por origem HTTPS.
4. Bloqueio se `ASAAS_SANDBOX_ENABLED=false`.
5. Reuso de checkout já reivindicado, sem criar outro no provedor.
6. Tratamento de HTTP 400, timeout, identificador malformado e estado incerto.
7. Webhook: HTTP 405 em método errado, 401 em token errado, 400 em evento não suportado ou ID inválido.
8. Os quatro eventos reconhecidos: `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED`.
9. O handler não registra pagamento em `dp.orders`, caixa ou Pixel.

## Neon SQL — testes reais em branch isolada

Branch `test-asaas-events-20261123` (sem compartilhar dados do restaurante) derivada de `production`.
- **Defeito reproduzido:** `CHECKOUT_CREATED` atrasado reativava checkout `canceled`.
- **Correção aplicada ao código:** transições de webhook aceitas somente quando status local for `creating`, `active` ou `uncertain`; estados terminais ficam travados.
- **Depois da correção:** cancelado permaneceu cancelado após evento tardio; pago permaneceu pago após expiração; reenvio de `event_id` retornou `inserted=0, updated=0`; referência de outro checkout não encontrou alvo.
- No branch QA, contagem de pedidos e fechamentos permaneceu em zero.
- Branch QA contém APENAS registros sintéticos de teste. A exclusão para liberar quota do Neon deverá ser aprovada e executada após revisão das evidências.

## Pendências para um TESTE REAL no Asaas Sandbox

1. Provisionar o gestor no Neon Auth e vincular `dp.staff` (manager) após validação de identidade.
2. Habilitar `BACKOFFICE_ENABLED=true` só depois de testar login/permissões.
3. Confirmar no Asaas Sandbox a URL `https://opanquecao.vercel.app/api/asaas-sandbox-webhook` e autenticação pelo token correspondente.
4. Habilitar `ASAAS_SANDBOX_ENABLED=true` somente em Production, com credenciais exclusivamente Sandbox. Reimplantar.
5. No Caixa do gestor criar um checkout de R$ 5,00. Testar Pix simulado pelo Sandbox, cartão de teste aprovado/recusado (nunca cartão real), cancelamento, expiração, reenvio/duplicidade do evento e falha temporária 503.
6. Conferir os estados em `dp.asaas_sandbox` e IDs em `dp.asaas_events` sem alterar pedidos, checkout público ou `dp.cash_closings`.
7. O checkout público REAL permanece desabilitado até definição do frete final, aceitação de pedido, conciliação, reembolsos e antifraude.

**Decisão de release:** o CI verde comprova o comportamento **mockado**. Não é prova de transação real com Asaas. Nunca habilitar cobrança de produção a partir desta auditoria.

Fontes: https://docs.asaas.com/docs/faq-do-asaas-checkout , https://docs.asaas.com/docs/eventos-para-checkout , https://docs.asaas.com/reference/confirmar-pagamento .

XTL — Feito para durar.
