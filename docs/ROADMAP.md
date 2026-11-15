# Disk Panquecão — roadmap e estado oficial

Atualizado em 2026-11-15. Repositório: samuelwhite777/opanquecao.

## Regra de entrega

O GitHub é a fonte oficial. Todo trabalho deve ser enviado para uma branch e documentado no repositório. Código apenas no ambiente de trabalho não conta como entrega. Preview só conta como publicado após URL e deploy verificados. Produção é a main; branches de desenvolvimento não representam aprovação para produção.

## Fases

1. **MVP do site — em andamento:** categorias, fotos, detalhes, seleção, carrinho, revisão e WhatsApp.
2. **Notificações e atendimento — implementação inicial nesta branch:** Telegram e PDF térmico; configuração e teste real pendentes.
3. **Conversão — pendente:** recomendações, bebidas/açaí, refinamento mobile e desempenho.
4. **Piloto XTL Food — planejado:** catálogo e operação administrativa, incluindo visibilidade e reajustes por categoria/ingrediente.
5. **ID e Core — planejado:** autenticação, permissões e integração operacional.
6. **Evolução e migração — planejado:** transição gradual sem interromper atendimento.

## Código desta branch

- index.html: botão Chamar no WhatsApp, Fazer pedido e formulário do carrinho.
- cart.mjs: seleção de opção, quantidade e observação, remoção, subtotal e mensagem WhatsApp.
- order-catalog.mjs: opções comerciais e recálculo de preços usado pelo servidor.
- api/order.js: validação, Turnstile e envio de PDF ao Telegram.
- api/order-config.js: disponibiliza somente a chave pública quando configuração completa existe.
- lib/order-pdf.js: PDF com itens em destaque; largura padrão 58 mm, configurável de 40 a 210 mm ou A4.
- package.json/package-lock.json/vercel.json: dependência PDF e inclusão do catálogo na função.

## Pendências para fechar fase 1

- [ ] Fluxo claro Escolher → Carrinho → Revisar → Enviar.
- [ ] Edição de quantidades/observações no carrinho e persistência ao recarregar.
- [ ] Entrega/retirada, endereço, pagamento e revisão final.
- [ ] Tratar produtos sob consulta e opções especiais no fluxo de compra.
- [ ] Teste visual e funcional em celular e desktop no preview.
- [ ] Aprovação da experiência e publicação em produção.

## Pendências da fase 2

- [ ] Configurar Telegram e Turnstile no ambiente correto, sem segredos no Git.
- [ ] Teste real de recebimento e impressão, inclusive larguras menores.
- [ ] Prevenção de pedidos duplicados em reenvios e persistência dos pedidos.
- [ ] Incluir no PDF os futuros campos de entrega e pagamento.

## Verificação de base

Na auditoria de 2026-11-15, produção e main correspondiam a da2840bf8943e36698fb888e3eb67cb70066b818. cardapio.json publicado era idêntico ao arquivo do repositório, com 82 produtos. O novo carrinho ainda não estava publicado. A consulta Vercel ao projeto opanquecao no escopo conectado retornou `404: not_found — Project not found`; isso não significa que o site esteja fora do ar.

## Configuração futura

Variáveis no servidor Vercel: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY. Opcional: ORDER_PRINT_WIDTH_MM (padrão 58). Nunca adicionar valores reais ao repositório. Sem configuração completa, o envio digital fica indisponível e o carrinho oferece WhatsApp. Nenhum recebimento real pelo bot foi validado nesta entrega.
