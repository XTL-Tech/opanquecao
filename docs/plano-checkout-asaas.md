# Plano técnico: checkout automático Asaas (ainda NÃO implementado)
Data: 22/11/2026 — Disk Panquecão / XTL TECH

## Situação real
- O checkout publicado hoje registra pré-pedido e abre WhatsApp, SEM cobrança online.
- O subtotal exclui entrega; frete e total são confirmados pela loja.
- O bot Telegram confirma o pré-registro, NÃO pagamento, envio da mensagem WhatsApp nem aceitação do pedido.
- Não habilitar pagamento em produção sem conta Asaas da loja, token webhook, banco persistente, homologação e aprovação dos valores de entrega.

## Fluxo proposto, seguro
1. Cliente monta carrinho e informa entrega/retirada/mesa. Servidor valida todos os itens, tamanhos, extras, disponibilidade e valores usando fonte oficial (nunca confiar nos preços enviados pelo navegador).
2. Gerar pedido imutável com código/UUID e status `PENDING_REVIEW`, persistido em banco transacional (ex.: PostgreSQL/Supabase), de forma isolada, sem documentos pessoais desnecessários.
3. Para entrega, loja confirma bairro, taxa final, estoque e tempo antes de gerar cobrança; para retirada/mesa, pode confirmar de modo automático SOMENTE após a operação configurar estoque, horário e aceitação, caso contrário pedir aceite também.
4. Depois do total final e aceitação, servidor cria Asaas Checkout hospedado: `POST /v3/checkouts`, `billingTypes` `PIX` e/ou `CREDIT_CARD`, `chargeTypes` `DETACHED`, `items` com preço em reais calculado no servidor, tempo de expiração, URLs de retorno. Token `ASAAS_API_KEY` SOMENTE no backend.
5. Armazenar `checkout.id` vinculado ao pedido e gerar URL oficial Asaas; cliente informa seus próprios dados de pagamento na hospedagem do Asaas, não no cardápio. CPF/CNPJ, se exigido, é coletado pelo prestador de pagamentos; não pelo formulário de pedido/local.
6. Receber `CHECKOUT_PAID`, `CHECKOUT_EXPIRED` e `CHECKOUT_CANCELED` por webhook. Comparar header `asaas-access-token` contra segredo `ASAAS_WEBHOOK_AUTH_TOKEN`, persistir ID do evento com UNIQUE para deduplicar e verificar a referência de checkout/pedido e valor esperado. Ignorar eventos inválidos, replays e eventos de pedido diferente.
7. Somente após pagamento REAL confirmado pelo webhook marcar `PAID`, liberar à cozinha e notificar no Telegram. Não usar a URL de sucesso como comprovação financeira.
8. Reembolsos, cancelamentos, pagamentos expirados e dupla cobrança precisam de fluxo operacional e auditoria. Nunca deixar pagamento aprovado gerar mais de uma comanda.
9. Meta Pixel/CAPI `Purchase` só após confirmação financeira; deduplicar evento, proteger informações pessoais, respeitar base legal/consentimento e enviar valor final real. `Lead` segue o evento de pré-registro.

## Estados sugeridos
`DRAFT` -> `PENDING_REVIEW` -> `APPROVED_AWAITING_PAYMENT` ->
`PAID` -> `PREPARING` -> `READY` -> `DELIVERED`.

Alternativas: `DECLINED`, `EXPIRED`, `CANCELED`, `REFUND_PENDING`, `REFUNDED`.

## Mínimos antes de habilitar
- Conta Asaas do titular do estabelecimento, com sandbox e API key delegada e segura;
- taxas negociadas/validadas no painel Asaas, sem presumir tarifa fixa;
- banco de pedidos persistente + eventos financeiros + idempotência + política de retenção LGPD;
- tabela de taxa por bairro homologada pela loja **ou** fluxo de aprovação manual do frete;
- webhook HTTPS com authToken, assinatura/segredo quando disponível, conciliação e testes de replay/falha;
- páginas de pagamento pendente/concluído/expirado sem afirmar pagamento pelo simples redirecionamento;
- homologação em sandbox de Pix, cartão, falhas, duplicidade, estoque indisponível, reembolso e entrega;
- aprovação explícita da loja antes de expor clientes a cobranças reais.

## Documentação oficial consultada
- https://docs.asaas.com/docs/checkout-asaas
- https://docs.asaas.com/docs/checkout-para-pix
- https://docs.asaas.com/docs/eventos-para-checkout
- https://docs.asaas.com/docs/sobre-os-webhooks
- https://docs.asaas.com/docs/como-informar-os-dados-do-cliente
