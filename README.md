# Disk Panquecão

Cardápio e pré-pedido do Disk Panquecão, Nova Hartz/RS. HTML, CSS e JavaScript, sem framework. Tecnologia XTL TECH.

## Ambientes e regra de entrega

- Produção: https://opanquecao.vercel.app — branch `main`.
- Revisão de UX: branch `feat/ux-pedido-simples`, com deploy Preview da Vercel.
- GitHub é a fonte oficial. Alteração apenas no computador não é entrega.
- Validar preview antes de mesclar. Não colocar credenciais, dados de clientes ou tokens no Git.

## Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| index.html | Identidade, categorias fotográficas, catálogo, navegação e estilos |
| cardapio.json | Fonte comercial: 82 produtos; preservar preços e ingredientes |
| cart.mjs | Opções, quantidades, resumo, armazenamento do carrinho e WhatsApp |
| order-catalog.mjs | Validação comercial e recálculo de preços |
| api/order-config.js | Disponibilidade do envio digital e chave pública |
| api/order.js | Validação no servidor, Turnstile e envio Telegram |
| lib/order-pdf.js | Comanda PDF, 58 mm por padrão |
| img/cardapio/ | Acervo aprovado de 82 fotografias otimizadas |
| favicons/oficial/ | Ícones oficiais |
| tests/order-flow.cjs | Testes funcionais com serviços simulados |
| docs/ROADMAP.md | Histórico do roadmap e pendências |

## Instalação e testes

Use Node.js 22.13+ (ou versão compatível com as dependências do lockfile).

```sh
npm ci
npm test
```

Os testes simulam Telegram e Turnstile; não enviam pedidos reais. Servir somente HTML por HTTP permite examinar o catálogo, mas as rotas `/api` precisam do ambiente Vercel. Não há etapa de build para o HTML. O `vercel.json` inclui o catálogo no pacote da função de pedido.

## Configuração de pedidos

No ambiente Vercel correto, cadastrar `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TURNSTILE_SECRET_KEY` e `TURNSTILE_SITE_KEY`. Nunca versionar valores. `ORDER_PRINT_WIDTH_MM` é opcional: padrão 58; suporta 40–210 mm ou `a4`. Validar no equipamento real antes de uso operacional.

Sem configuração completa, o usuário continua pelo WhatsApp. Abrir o WhatsApp não equivale a enviar: o cliente deve enviar a mensagem e a loja confirmar o pedido. A mensagem não inclui subtotal.

O carrinho fica somente no navegador por até 24 horas após a última atualização. Ao restaurar, produtos/opções são validados e preços recalculados pelo catálogo atual. Nome/telefone não são persistidos. Armazenamento bloqueado ou inválido não impede o pedido.

## UX desta branch

- Categorias em cartões com fotos existentes: duas colunas no celular e quatro em telas maiores.
- Entrada em uma categoria por vez; retorno ao cartão de origem e navegação Voltar do navegador.
- Botão `+ Adicionar`; opções em botões selecionáveis, feedback e barra `Ver pedido`.
- Nenhum produto, preço, categoria ou foto é inventado para reproduzir o mockup.
- A API continua recalculando preços; dados do navegador não são fonte confiável de valor.

## Auditoria e refatoração

Removida a lógica de acompanhar categorias pelo scroll: era incompatível com a nova navegação por categoria e alterava seleção sem ação do cliente. Substituída por navegação explícita com histórico e retorno. O seletor legado fica oculto quando a melhoria é inicializada, preservando o comportamento base se necessário.

Configurações revisadas: `pdf-lib`, `jsdom`, `vercel.json` e as duas rotas de API são utilizados. Não há dependência de React/Next, nem configuração de build a remover. Os arquivos ignorados (node_modules, .env e .vercel) não fazem parte da entrega.

Fotos antigas na raiz de `img/` e favicon legado serão removidos apenas após confirmar ausência de referências; o acervo oficial, incluindo versões de marca, permanece preservado. A ausência de referência em HTML não prova ausência de links externos.

## Limites e pendências

Entrega/retirada/mesa, endereço, pagamento, edição de observações no carrinho e revisão final ainda precisam ser implementados. Telegram real, prevenção de duplicidades e impressão física aguardam validação. A fase 1 ainda não está encerrada. Não exibir avaliações, escassez ou selos de popularidade sem dados reais.

## Publicação e recuperação

Cada alteração deve ter commit, teste e preview. Ao aprovar, mesclar a branch na main; confirmar o deploy e comparar HTML, módulos e catálogo servidos na produção com o commit. Em regressão, reverter o commit no GitHub e verificar o novo deploy. Não apagar o histórico para fazer rollback.

## Açaí e adicionais

O card inteiro abre a configuração, além do botão de adicionar. Os complementos são dados estruturados validados no navegador e novamente no servidor. Açaí 300 ml permite até 3 grátis, 500 ml até 4, conforme o JSON vigente. O cliente pode escolher menos. Ao reduzir de 500 para 300 com quatro selecionados, precisa desmarcar um; nada é removido silenciosamente. Cada adicional pago cadastrado pode ser selecionado uma vez por unidade; o valor é multiplicado pela quantidade. Resumo, WhatsApp e PDF listam as escolhas. WhatsApp continua sem subtotal ou preços.

Para outros produtos, o catálogo ainda não fornece uma tabela comercial de adicionais. Não há cobrança inventada: o modelo de grupos poderá ser ampliado após definição de ingredientes, preços, limites e elegibilidade. Não usar o campo de observações como autorização automática de adicionais pagos.
