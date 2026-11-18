# Disk Panquecão

Cardápio e pré-pedido do Disk Panquecão, Nova Hartz/RS. HTML, CSS e JavaScript, sem framework. Tecnologia XTL TECH.

## Produção: pedido simplificado pelo WhatsApp — 18/11/2026

**Fluxo público:** selecionar produtos, opções, sabores, quantidades, complementos e observações (inclusive observação geral opcional) → **Enviar pedido pelo WhatsApp**. O número comercial é (51) 99738-3849.

- **Sem formulário de nome/telefone, endereço, entrega/retirada, pagamento ou checkout.** Esses dados e a taxa de entrega são combinados com a loja na conversa.
- O site apresenta o **subtotal dos itens, sem frete**; mensagem com itens, preços e observações é gerada no navegador. A loja confirma disponibilidade e total final antes do preparo.
- Cliente precisa tocar em **Enviar** dentro do WhatsApp. O site mantém o carrinho para revisão, oferece link alternativo e não alega recebimento automático.
- Sem Telegram, Turnstile, gateway ou chamada a `/api/order` no fluxo público. A disponibilidade continua respeitando o horário da loja.
- A branch **`homologacao/checkout-completo`** preserva o formulário e recursos completos anteriores para evolução isolada, sem promoção automática à produção. Implantar o sistema completo somente após homologação funcional, segurança e testes reais.
- CI: `npm test`, incluindo testes de montagem da mensagem e interação do carrinho. Confirmar a abertura em Android e iPhone e a operação do WhatsApp comercial em teste real.

> As seções históricas abaixo documentam APIs/experimentos antigos e não descrevem o formulário vigente na produção.

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

## Entregas por cidade, bairro e taxa (branch feat/panquecas-dois-sabores-selecao)

- O cliente escolhe somente **Nova Hartz/RS** ou **Araricá/RS**. Cidade, bairro/localidade, rua/estrada e número são obrigatórios em **Entrega**. CEP, complemento, ponto de referência e GPS são opcionais (o GPS continua condicionado à permissão explícita).
- As opções de bairro/localidade são carregadas de `delivery-areas.json`, filtradas pela cidade. **Outro bairro / localidade** permite informar regiões que não constem da lista, sempre sujeitas à confirmação manual.
- Cadastro inicial: localidades identificadas por fontes municipais e bases públicas (algumas são **loteamentos e comunidades rurais**, não bairros administrativos). Araricá: [Plano Diretor municipal](https://ararica.rs.gov.br/uploads/legislacao/59/f_uCdK2QK_Lv9eBhp9vbxLdMQP1_9hal.pdf) e [Plano Municipal de Cultura](https://snc.cultura.gov.br/media/docs/plano/2137/ilovepdf_merged-2_vhVX78U.pdf); Nova Hartz: [cadastro municipal por região](https://vet.novahartz.rs.gov.br/) e [notícia sobre bairros atendidos](https://www.correiodopovo.com.br/not%C3%ADcias/cidades/entregue-primeira-etapa-da-obra-de-implanta%C3%A7%C3%A3o-do-sistema-de-abastecimento-de-%C3%A1gua-em-nova-hartz-1.1560001). **A lista e o raio efetivo de atendimento precisam de validação comercial da loja.**
- Taxa padrão por cidade no arquivo `delivery-areas.json`: **Nova Hartz R$ 7,00** e **Araricá R$ 10,00**. O campo `defaultFeeCents` é expresso em centavos e só se aplica aos bairros cadastrados da cidade. A interface e a comanda Telegram mostram o valor e o subtotal com entrega. Em "Outro bairro/localidade", a cobertura e taxa seguem **a confirmar**.
- Para configurar exceções de preço por bairro, trocar o respectivo `"feeCents": null` por `"feeCents": 500` para R$ 5,00, via Pull Request aprovado. `null` herda a taxa padrão da cidade; `0` representa entrega gratuita. Nunca registrar reais decimais: os valores são em centavos.
- A API verifica cidade/bairro no catálogo do servidor, recalcula o valor e o inclui na comanda. Nunca confiar em cidade, taxa ou subtotal enviados pelo cliente. Localidade não cadastrada requer revisão humana, sem cobrança automática.
- Taxas padrão municipais informadas pela gestão. A loja deve homologar a área real de cobertura, conferir exceções, e confirmar o pedido antes de cobrar. O pré-pedido não representa aceitação automática nem cobrança final.

## Diagnóstico de falha no iPhone / Safari

- Antes desta melhoria, não havia logs suficientes para diferenciar validação HTML bloqueada de erro no Telegram, nem mensagens claras quando Turnstile não carregava. Logs antigos não podem ser reconstruídos.
- Os novos envios à `/api/order` usam o cabeçalho `X-Checkout-Trace` com um identificador aleatório de oito caracteres. O servidor registra somente `event: checkout`, `trace`, `step`, ambiente e código HTTP (sem nome, telefone, endereço, token ou conteúdo da comanda).
- Caso o navegador bloqueie campos obrigatórios, o cliente vê "Preencha ou corrija" com indicação do campo. Se a API falhar, a mensagem exibe o código de diagnóstico para buscar nos logs Vercel.
- **Sem confirmação explícita do Telegram, não é seguro reenviar automaticamente:** o pedido pode ter chegado e a resposta se perdido. Oriente verificar com a loja antes de reenviar.
- Testes automatizados de JSDOM não substituem homologação em Safari iOS real. Antes do merge, testar preenchimento completo e Turnstile no iPhone, em Preview, usando dados fictícios e marcando TESTE — NÃO PREPARAR.

## Panquecas meio a meio

- Cada panqueca 2 sabores exige seleção de **duas metades diferentes**. Nos dois salgados, a escolha vem do cardápio de panquecas salgadas; nos dois doces, das doces; na mista, a primeira salgada e a segunda doce.
- As escolhas são validadas no servidor e impressas separadamente na comanda. O preço atual de **R$ 42,00** é preservado.

## Instalação e testes

Use Node.js 22.13+ (ou versão compatível com as dependências do lockfile).

```sh
npm ci
npm test
```

Os testes simulam Telegram e Turnstile; não enviam pedidos reais. Servir somente HTML por HTTP permite examinar o catálogo, mas as rotas `/api` precisam do ambiente Vercel. Não há etapa de build para o HTML. O `vercel.json` inclui o catálogo no pacote da função de pedido.

## Configuração de pedidos

No ambiente Vercel correto, cadastrar `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TURNSTILE_SECRET_KEY` e `TURNSTILE_SITE_KEY`. Nunca versionar valores. `ORDER_PRINT_WIDTH_MM` é opcional: padrão 58; suporta 40–210 mm ou `a4`. Validar no equipamento real antes de uso operacional.

Sem configuração completa, o checkout digital fica indisponível e informa que nenhuma solicitação foi enviada. O carrinho deixa de enviar pedidos via WhatsApp. A loja continua responsável por confirmar disponibilidade, taxa e prazo.

O carrinho fica somente no navegador por até 24 horas após a última atualização. Ao restaurar, produtos/opções são validados e preços recalculados pelo catálogo atual. Nome/telefone não são persistidos. Armazenamento bloqueado ou inválido não impede o pedido.

## Checkout: entrega, retirada e mesa (branch feat/checkout-entrega-retirada-mesa)

- O carrinho oferece **Entrega**, **Retirada** ou **Comer no local**. Entrega requer endereço completo; mesa exige identificação. Não são cobradas taxas inventadas.
- Para entrega, o cliente pode tocar em **Usar minha localização atual**: o navegador solicita permissão na hora e, se autorizada, envia coordenadas GPS junto ao endereço para a comanda Telegram. Não há captura automática. Precisão do GPS é aproximada.
- Pedidos digitais são enviados à loja por Telegram com PDF de 58 mm (largura configurável); a tela informa que se trata de um **pré-pedido**, aguardando confirmação pelo WhatsApp fornecido. O sistema **não envia mensagens automáticas de WhatsApp**.
- Sem Turnstile ou Telegram configurados, o carrinho exibe as opções para inspeção, porém **bloqueia o botão de envio**, indica indisponibilidade e **não cria pedido nem envia carrinho por WhatsApp**. O link genérico de contato, em outras áreas do site, não faz parte do checkout.
- A API valida o tipo de atendimento, endereço, mesa e latitude/longitude no servidor. Retirada e mesa não transmitem GPS.
- `ORDER_ESTIMATE_DELIVERY_MIN` e `ORDER_ESTIMATE_PICKUP_MIN` (opcionais, inteiros de 5 a 240) permitem à **loja** declarar prazo estimado exibido ao cliente. Se não forem configurados, o site informa que o prazo será confirmado pela loja. Nunca inventar previsão nem prometer prazo fixo.
- Testes automatizados: `npm ci && npm test`. O workflow GitHub Actions `.github/workflows/order-flow.yml` roda a suíte nas branches `feat/**` e nos PRs para `main`, sem credenciais reais.
- Antes de ativar os pedidos: configurar os tokens do Telegram e Turnstile no ambiente Vercel correto, realizar envio de TESTE para chat de homologação e validar PDF na impressora física. Confirmar com a loja os prazos, taxas e raio de entrega.

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

Entrega/retirada/mesa e endereço já estão implementados nesta branch. Pagamento, edição de observações no carrinho e revisão final seguem pendentes. Telegram real, prevenção de duplicidades e impressão física aguardam validação. A fase 1 ainda não está encerrada. Não exibir avaliações, escassez ou selos de popularidade sem dados reais.

## Publicação e recuperação

Cada alteração deve ter commit, teste e preview. Ao aprovar, mesclar a branch na main; confirmar o deploy e comparar HTML, módulos e catálogo servidos na produção com o commit. Em regressão, reverter o commit no GitHub e verificar o novo deploy. Não apagar o histórico para fazer rollback.

## Açaí e adicionais

O card inteiro abre a configuração, além do botão de adicionar. Os complementos são dados estruturados validados no navegador e novamente no servidor. Açaí 300 ml permite até 3 grátis, 500 ml até 4, conforme o JSON vigente. O cliente pode escolher menos. Ao reduzir de 500 para 300 com quatro selecionados, precisa desmarcar um; nada é removido silenciosamente. Cada adicional pago cadastrado pode ser selecionado uma vez por unidade; o valor é multiplicado pela quantidade. Resumo, WhatsApp e PDF listam as escolhas. WhatsApp continua sem subtotal ou preços.

Para outros produtos, o catálogo ainda não fornece uma tabela comercial de adicionais. Não há cobrança inventada: o modelo de grupos poderá ser ampliado após definição de ingredientes, preços, limites e elegibilidade. Não usar o campo de observações como autorização automática de adicionais pagos.

## Validação histórica do preview — 15/11/2026

Deploy `a5d8896c9c42157332ff4debf7498f18b7b71bbf` confirmado como concluído no GitHub/Vercel. Acesso autenticado ao preview validado pelo navegador.

- Card de açaí abre a personalização ao clicar no título, sem depender do botão.
- 500 ml: quatro grátis selecionados, demais opções grátis desabilitadas.
- Nutella adicionada: R$ 28 + R$ 5 = R$ 33; escolhas presentes no resumo.
- Recarregar a página preserva tamanho, quatro grátis e adicional pago.
- Link do WhatsApp inclui escolhas e não inclui preço/subtotal; nenhuma mensagem real enviada.
- Testes automatizados aprovados; catálogo idêntico à main na comparação Git.
- Inspeção visual realizada em desktop. Validação em aparelhos móveis e impressora física ainda pendente.

### Próxima etapa: Telegram

Configurar as quatro variáveis citadas acima no projeto existente, inicialmente em Preview. O bot precisa estar iniciado no chat de destino e ter permissão de envio. Validar com pedido explicitamente identificado como TESTE, verificar PDF e depois habilitar em produção. Token nunca deve entrar em código, documentação ou chat. O envio real ainda não foi validado.

## Atualização — açaí e carregamento

Açaí 300 ml e 500 ml aparecem em cards separados, com tamanho fixo, preços e limites originais. O JSON comercial permanece inalterado; ambos usam a fotografia aprovada. O carrinho mantém os tamanhos distintos. O catálogo começa a carregar sem aguardar Turnstile; falhas exibem opção de tentar novamente.

## Descoberta pública por IA, buscadores e agentes

- `llms.txt` e `llms-full.txt`: fatos públicos e limites de interpretação, sem credenciais.
- `ai/business.json`: perfil público de contato, cidades, política de pré-pedido e horário de referência com `verified_by_owner=false`.
- `ai/catalog-summary.json`: categorias e contagem; preços continuam sob a API/catálogo comercial.
- `ai/agents.md` e `ai/faq.md`: explicação e perguntas frequentes para assistentes.
- `robots.txt` e `sitemap.xml`: descoberta e limites básicos para indexação.
- `index.html`: metadados SEO + Restaurant JSON-LD; sem horários estruturados enquanto não forem confirmados pelo responsável.

**Governança:** publicações são informações visíveis para crawlers embora não ocupem a interface. Não há conteúdo secreto ocultado aqui. O diretório externo aponta qua–dom 19h–23h, seg/ter fechados; confirmar dias/horas e endereço exato com a loja antes de marcar como oficial e ativar eventual bloqueio de pedidos fora do expediente.

**Redução de duplicações:** o cabeçalho conserva somente identidade/atalhos; telefone e localização ficam nas seções de Contato/Como chegar; o aviso redundante de seleção de categoria foi removido. Observações do catálogo foram consolidadas sem mudar as 12 categorias, os 82 produtos ou preços. CI testa a consistência com os arquivos de IA.
