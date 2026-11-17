# XTL Food — Migração de cardápio para Supabase

## Estado
**Preparado, não ativado em produção**. Não há projeto Supabase do Panquecão criado nem credenciais provisionadas.
Exige decisão da organização (recomendação: **XTL**, projeto dedicado), autorização de custo se houver, e aprovação manual do PR.

## Fonte oficial e preservação
- Origem: `cardapio.json` versionado neste repositório, contendo **12 categorias e 82 produtos**.
- `202611170001_initial_catalog.sql` cria `restaurant_catalogs`, `restaurant_catalog_history` e `restaurant_operations`, com RLS.
- `202611170002_seed_catalog.sql` importa o JSON original completo, sem alterações em ingredientes, preços e extras. O seed não substitui catálogo já editado no Supabase (`ON CONFLICT DO NOTHING`).
- Os 82 arquivos de imagem continuam em `img/cardapio/`; não há mudança de URLs ou armazenamento nesta fase.
- `restaurant_catalog_history` mantém revisões anteriores. Os valores não são reescritos pela rotina de checagem.
- As tabelas são isoladas em projeto dedicado. Leitura pública do catálogo permitida; escrita administrativa não é liberada ao navegador.

## Configuração segura do projeto
1. Confirmar a organização Supabase e criar projeto exclusivo para o Panquecão (preferir região São Paulo `sa-east-1`), **somente após confirmação de eventuais custos**.
2. Executar as duas migrações **em ordem**; não rodar em projetos LinkSul nem XTL Core.
3. Verificar total no banco:
   ```sql
   select restaurant_id, jsonb_array_length(catalog->'categorias') as categorias,
      (select sum(jsonb_array_length(c->'itens')) from
       jsonb_array_elements(catalog->'categorias') c) as produtos
   from public.restaurant_catalogs where restaurant_id='opanquecao';
   -- Esperado: opanquecao | 12 | 82
   ```
4. Na Vercel, configurar **Preview primeiro**: `SUPABASE_URL` (`https://<ref>.supabase.co`), `SUPABASE_PUBLISHABLE_KEY` (chave pública RLS) e `CATALOG_SOURCE=supabase`. **Nunca** publicar uma service-role/secret key no HTML, JavaScript do navegador ou GitHub.
5. Testar Preview: `GET /api/catalog` deve retornar 12 categorias e 82 produtos, `GET /api/health/supabase` deve responder `{"ok":true,"status":"catalog_online"}`, e pedidos fictícios devem recalcular preços do mesmo banco.
6. Depois da aprovação manual e da homologação do checkout/Telegram, repetir variáveis no ambiente Production e gerar novo deploy.
7. Plano de reversão: definir `CATALOG_SOURCE` diferente de `supabase` e redeploy. Nesse estado, leitura e preços dos pedidos usam o `cardapio.json` original. **Nunca servir catálogo antigo enquanto o banco ativo estiver marcado como fonte oficial**.

## Horários e backoffice
A tabela `restaurant_operations` foi criada com `time_zone=America/Sao_Paulo`,
`accepting_orders=true`, `enforce_opening_hours=false` e `weekly_schedule={}`.
**Não foram inventados horários**. O bloqueio fora do expediente, interfaces de edição de preços, autenticação administrativa e auditoria de ações humanas ficam para a etapa de backoffice, que deverá bloquear pedidos **no servidor** antes da entrega ao Telegram.

## Checagem e atividade periódica
- Endpoint `GET /api/health/supabase` efetua uma consulta **real**, sem cache, à tabela pública do cardápio.
- GitHub Action `supabase-health.yml` agenda execução 4 vezes/dia (a cada 6 horas), mas exige habilitar a variável do repositório `PANQUECAO_SUPABASE_MONITOR_ENABLED=true` **após** o banco e a Vercel estarem prontos e a funcionalidade ser mesclada em `main`.
- Consultas recentes ao banco podem reduzir a chance de inatividade no Supabase Free, mas não garantem que não haverá pausa. GitHub Actions cron também pode atrasar ou não executar pontualmente.
- Um projeto de produção com exigência de alta disponibilidade deve usar Supabase Pro ou superior, com monitoramento/alertas e backups adequados. A documentação oficial: https://supabase.com/docs/guides/platform/free-project-pausing
- Se GitHub Actions falhar, revisar o fluxo na guia **Actions** e configurar notificações. Não há envio proativo de alerta ao responsável nesta primeira versão.

## Segurança operacional
- Não armazenar credenciais na fonte GitHub.
- Não misturar dados de restaurantes, LinkSul ou XTL Core.
- Não publicar banco como fonte de preços antes de testar concordância com o catálogo original.
- Se Supabase indisponível após a troca, `/api/catalog` responde 503 e o servidor **não aceita pedidos** com preços desatualizados.
- Alterações administrativas futuras devem ser autenticadas, autorizadas e auditadas, com backups testados e limites de acesso.
