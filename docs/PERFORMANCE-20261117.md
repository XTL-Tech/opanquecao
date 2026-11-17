# PERFORMANCE-20261117 — Disk Panquecão

## Objetivo e estado
Melhorar a primeira visita com rede móvel, **preservando o checkout, preços, Telegram,
QR e Code128, o cardápio com 82 produtos, HTML/CSS/JS e metadados públicos para IA**.

### Inventário e economia reproduzível
- Originais: **82 WebP, 19.557.494 bytes** em `img/cardapio/`.
- Variantes: **82 WebP, 1.839.660 bytes** em `img/cardapio-lite/`.
- Economia do conjunto de versões: **90,6%**, medida na GitHub Action;
  as fotos originais permanecem no repositório para o modal de ampliação.
- Primeiras quatro capas: **1.073.236 → 99.724 bytes** no total.
- Composição das imagens: Pillow 11.3.0, dimensão máxima 560 px,
  WebP qualidade 67, removendo metadados EXIF.
- Relatório e dimensão por imagem: `img/cardapio-lite/optimization-report.json`.
- Regenerar após mudar fotos: `python scripts/generate-cardapio-lite.py`.

**A economia do catálogo não é a redução de tempo do site inteiro.**
O navegador carrega somente imagens exigidas pela interação e viewport,
e os tempos reais dependem de TTFB, rede, CPU, cache e bibliotecas externas.

### Alterações de rede e interação
- `GET /api/catalog` responde diretamente **200 JSON**, eliminando
  redirecionamento 307 para `cardapio.json` em modo arquivo.
- Modo arquivo admite cache da CDN `s-maxage=300`, cliente `max-age=30`.
  Modo Supabase tem `no-store` para não servir preços desatualizados.
  Erros 503 também são `no-store`; **não fazer fallback silencioso a preço antigo**.
- `vercel.json` inclui `cardapio.json` na função `api/catalog.js`;
  sem isso a função publicada pode não encontrar o arquivo.
- Na página, `/api/catalog` deixa de solicitar `cache:'no-store'`.
- Lista e cartões usam thumbnails; apenas o modal carrega o original ao abrir.
- No máximo duas capas de categorias carregam com `eager`;
  a primeira ganha prioridade alta, demais permanecem `lazy`.
- Turnstile só é requisitado ao abrir o carrinho e confirmar a necessidade de
  verificação, em vez de carregar na inicialização da home. Falhas são
  **fail-closed**, preservando botão de WhatsApp como contingência.

### Qualidade e validação
- `npm ci && npm test` inclui testagem de catálogo/API, 82 imagens e novas
  regras de carregamento; workflow valida cache e orçamento.
- Validar em **homologação**: página com categorias, escolher duas opções,
  abrir modal com foto original, carrinho, turno de pagamento, Turnstile,
  geração de PDF/QR/Code128 e pré-pedido sintético.
- Validar em **iPhone Safari** e Android Chrome, 4G lento e cache frio/quente.
- Medir: LCP, INP, CLS no percentil 75, FCP, TTFB, `/api/catalog` e
  bytes das quatro primeiras capas. Metas recomendadas LCP <=2,5s,
  INP <=200ms, CLS <=0,1. Essas metas **não são resultados já obtidos**.
- Rollback: deployment anterior na Vercel antes de publicar; **não ativar**
  Supabase/ledger por causa desta otimização.

### Registro de risco
As thumbnails são assets obrigatórios antes do deploy; CI falha se falta
alguma imagem. Originais não são removidos. O ponto de restauração é o deploy
Vercel anterior. Recursos externos Meta Pixel, Google Fonts e ícones não
foram excluídos nesta mudança; otimizações adicionais precisam de teste de
consentimento, layout e métricas antes de serem priorizadas.
