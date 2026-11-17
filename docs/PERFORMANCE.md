# XTL | Eficiência de free tier — piloto O Panquecão

## O que foi alterado (sem mudar o fluxo de pedidos)
- `/cardapio.json`: cache de navegador por até **30 segundos**. O checkout **sempre recalcula preços no servidor**; cache público não é autoridade de preço.
- `/img/*` e `/favicons/*`: cache no navegador por **1 dia**. Não usar `immutable`, pois os nomes não são versionados.
- `/api/order-config`: retorna somente configuração pública; cache **15 s no navegador e 60 s na CDN Vercel**. Mudanças operacionais podem levar algum tempo para aparecer no cliente. `/api/order` continua `no-store`.
- O catálogo migrado via PR de Supabase mantém política separada: **não aplicar cache à API de catálogo dinâmico sem invalidação planejada**.

Os arquivos estáticos já são distribuídos pela CDN Vercel. Esta alteração reduz downloads repetidos no dispositivo e pode diminuir invocações da função de configuração; não aumenta limites contratados, nem prova capacidade para N usuários.

## Orçamento e proteção
- `node tests/cache-policy.cjs`: verifica cache explícito só em recursos públicos, proíbe regressão para `/api/order`, e impõe limite de 400 KiB por foto WebP e 22 MiB ao acervo `img/cardapio`.
- Os limites de imagens são preventivos; podem ser reduzidos após nova compressão visual e validação.
- Preservar Pixel, Analytics, WhatsApp, carrinho, dados de produtos e bot Telegram.

## Plano de carga (executar em homologação, nunca em produção sem janela)
1. Identificar requisições reais no navegador (HTML, fotos, cardápio, config) e comparar antes/depois usando `curl -I` e a aba Network. Validar `Cache-Control`.
2. Simular **25 / 50 / 100 / 250 / 500** navegadores: primeiro abertura do catálogo, depois navegação nas categorias. Não enviar pedidos reais, não acionar Telegram e não utilizar tokens válidos de Turnstile sem autorização.
3. Medir p50/p95/p99, taxa de erro, CDN hit ratio, bytes transferidos e invocações de funções. Medir o banco separadamente depois da migração.
4. Critérios iniciais de investigação (não são SLA contratual): HTTP 5xx acima de 1%, p95 de abertura do cardápio acima de 3 s em rede móvel controlada, ou consumo diário de quotas projetado acima de 70%.
5. Testar falhas: indisponibilidade do banco, Telegram lento, retry duplicado, rate limit, estoque/preço divergente. Não aceitar um pedido se não for possível registrar e confirmar seu estado com segurança.

## Prioridades arquiteturais XTL
**SECURE > STABLE > SIMPLE > SCALABLE.** Manter a plataforma atual leve antes de introduzir Go ou Rust. Servir ativos via CDN; executar somente APIs realmente dinâmicas; isolar dados por aplicação/tenant com RLS; preferir webhooks e filas a polling; implementar idempotência persistente de pedidos **antes** de permitir retries automáticos.

## Implantação e reversão
- Aprovação via PR, CI e Preview; produção permanece intacta até merge.
- Não alterar domínio, proxy Cloudflare, DNS, token, Supabase ou preços como parte deste PR.
- Se comportamento de cache não for adequado, reverter o PR e confirmar os headers após o novo deploy.
