# XTL Food — Isolamento no Supabase compartilhado

## Aplicado no laboratório

- Projeto: oksafggcaotekrvwvqgg (XTL Core ID lab). A migration Supabase xtl_food_runtime_least_privilege_v1 foi aplicada.
- Criado papel PostgreSQL xtl_food_runtime, NOLOGIN, sem BYPASSRLS e sem senha. Nenhuma credencial foi disponibilizada ao Panquecão.
- Oito políticas RLS permitem apenas a empresa opanquecao em quatro tabelas operacionais. Permissões SELECT, INSERT e UPDATE foram limitadas às colunas e transições necessárias. Nenhuma permissão DELETE.
- A consulta has_table_privilege confirmou que este papel não pode ler xtl_people, xtl_memberships ou isp_commercial_contacts.
- O ambiente administrativo conectado negou SET ROLE; falta validação real como esse papel após provisionar credencial específica.
- Decisões finais de aprovado/rejeitado exigem mensagem Telegram e operador registrado.

## Segurança operacional

- Os módulos de ledger, revisão e horários rejeitam o SUPABASE_SECRET_KEY global se a URL for o banco compartilhado ou FOOD_DB_TOPOLOGY=shared.
- Não configurar service_role ou SUPABASE_SECRET_KEY do XTL Core no ambiente Vercel da loja.
- É necessário criar uma credencial de login restrita que herde apenas xtl_food_runtime e implementar um driver Postgres parametrizado com TLS, timeouts, pool limitado e lockfile de dependências.
- Até então ORDER_APPROVAL_MODE e ORDER_LEDGER_MODE devem permanecer desativados no projeto compartilhado.
- O catálogo público pode usar somente a publishable key e RLS existente; não precisa de chave global.

## Testes e pontos pendentes

- Executar via usuário do aplicativo: tentativa de ler XTL ID, LinkSul e outras empresas; SELECT Food; escrita de PII; DELETE; decisão duplicada; alteração indevida de status; erros de rede; estoque e horários.
- Configurar bot Telegram somente de teste e URL Preview exclusiva; não transferir webhook do bot da produção.
- Necessários ainda backup/restore, alertas, revisão SECURITY DEFINER do Core, proteção de senhas vazadas, E2E no celular e painel admin.

Este documento descreve uma fundação de segurança, não um backend operacional já habilitado.
