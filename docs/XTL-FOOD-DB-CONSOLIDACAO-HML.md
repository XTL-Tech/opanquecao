# XTL Food — Consolidação no banco unificado (homologação)

Data: 2026-11-17. Decisão do responsável: utilizar um único projeto Supabase XTL, com XTL ID, empresas e aplicativos segregados por vínculos, permissões e RLS.

## Banco REAL verificado
- Supabase organização XTL, projeto de **LABORATÓRIO** `xtl-core-id-lab` (`oksafggcaotekrvwvqgg`, região `sa-east-1`).
- **Nenhum** banco de produção do Panquecão foi criado e nenhuma variável Vercel de produção foi alterada.
- Já existiam `xtl_companies`, `xtl_company_accounts`, `xtl_projects`, `xtl_project_members`, `xtl_accounts`, `xtl_people`, `xtl_memberships`.
- Criado vínculo privado `xtl_food_restaurant_bindings`: `restaurant_id=opanquecao` aponta ao projeto `disk-panquecao`, empresa Disk Panquecão, conta Disk Panquecão.
- Aplicadas no Supabase as migrações registradas **`xtl_food_shared_lab_catalog_v1`** e **`xtl_food_shared_lab_orders_review_v1`** (com adaptações multiempresa aos SQL originais 001,003,004,005).
- Criadas as tabelas `restaurant_catalogs`, `restaurant_catalog_history`, `restaurant_operations`, `restaurant_operations_audit`, `restaurant_order_intents`, `restaurant_preorder_reviews`.
- FK de catálogo para o vínculo do projeto; FK de revisão para o ledger (par `restaurant_id,request_id`); FK para auditoria histórica. Sem exclusão em cascata.
- `restaurant_catalogs`: seed do arquivo **`cardapio.json` atual na branch `main`**, não do seed 002 antigo. A diferença do seed antigo está nas observações comerciais, que NÃO foram copiadas. Verificado `catalog = cardapio.json::jsonb`, 12 categorias e 82 produtos.
- Tabelas sensíveis: RLS ativo, nenhuma permissão para anon/authenticated; catálogo público: SELECT limitado a `opanquecao`, sem escrita no navegador. Ensaio de SELECT sem privilégio autenticado às revisões recusado como esperado.
- Teste de transição `pending_review -> approved` feito com pedido fictício em transação `ROLLBACK`. Contagem persistida de ledger e revisões: 0 antes do teste; reverificar após.
- Horários oficiais **não** cadastrados: `enforce_opening_hours=false` no laboratório, não equivalem a status real de operação.

## Bloqueio de segurança para ativação real
**ATENÇÃO: o projeto Supabase agora é COMPARTILHADO. NÃO aplicar a orientação anterior de conectar `SUPABASE_SECRET_KEY` / `service_role` diretamente ao servidor Vercel do Disk Panquecão**: tal credencial daria acesso aos dados de XTL ID, Jarbas e LinkSul, contrariando o isolamento entre empresas.
A PR #24 contém um adaptador REST que pressupõe projeto dedicado; ele precisa ser substituído por uma camada backend com privilégio estritamente limitado ao tenant, validação de pedidos, rate limit, auditoria, e proteção de dados, antes de qualquer E2E real ou ativação.
Não configurar `ORDER_LEDGER_MODE=required` nem `ORDER_APPROVAL_MODE=required` usando service-role global do projeto compartilhado.
Preferir gateway XTL Food autenticado, com operações específicas sobre as tabelas do restaurante e credenciais não reutilizadas. Conferir os direitos via revisões de segurança e testes negativos.

## Pré-condições e próximos passos
1. Versionar as migrações multiempresa/reproduzíveis; comparar o catálogo e proteger backups/restore antes de alterar algo real.
2. Implementar credencial de serviço de escopo Food (nunca credencial global) e adaptador que valide `restaurant_id` no servidor.
3. Configurar apenas em Preview com bot Telegram de testes e atendentes autorizados, validar aprovação/rejeição e idempotência reais.
4. Completar painel admin e horários aprovados; push precisa de opt-in e infraestrutura.
5. Realizar testes E2E e auditoria RLS/permissões/segredos; validar reversão sem perder dados.
6. Apenas após aceite explícito, planejar migração da produção; manter sistema atual intacto.

Avisos de segurança preexistentes do `xtl-core-id-lab`: Supabase Advisors aponta `public.xtl_backoffice_snapshot` como `SECURITY DEFINER` invocável por authenticated e proteção contra senhas vazadas desativada. Revisar antes de abrir sistemas a clientes.

Os arquivos antigos desta branch que afirmam “projeto dedicado obrigatório” descrevem a arquitetura ANTERIOR à decisão de consolidação; esta nota registra a mudança aprovada. Não executar cegamente o seed 002 nem vincular chaves globais no Vercel.
