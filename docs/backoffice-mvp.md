# Backoffice Disk Panquecão — Vercel + Neon eficiente (22/11/2026)

## Situação técnica
- Aplicação no GitHub/Vercel preparada para Neon PostgreSQL e Neon Managed Auth.
- CONEXÃO REAL PENDENTE: nenhuma integração Neon está instalada no projeto Vercel, e não há credenciais de Asaas Sandbox. O sistema mantém BACKOFFICE_ENABLED desativado por padrão.
- Modo demonstrativo acessível em `/backoffice/?demo=1`, sem dados reais nem banco.
- Não usa Supabase na arquitetura nova. Arquivos e migrações antigos continuam apenas como histórico; não aplicar no Neon.

## Economia do Neon Free
1. Driver HTTP `@neondatabase/serverless` fixado; não usa pool TCP por execução e não mantém conexões abertas na Vercel.
2. Sem cron e sem polling constante. A equipe atualiza o painel manualmente. Neon pode entrar em repouso quando ocioso.
3. Dashboard busca até 80 pedidos recentes, 100 clientes e 14 fechamentos; o catálogo NÃO é consultado nessa abertura.
4. Somente ao abrir Preços do cardápio ou Pedido manual o catálogo de 82 itens é carregado. Busca de clientes envia filtro ao PostgreSQL com limite de 51 registros.
5. Totais de caixa são agregados diretamente no SQL com índice parcial por dia/status, sem baixar todo o histórico.
6. Fotos e vídeos permanecem arquivos estáticos otimizados na Vercel, nunca blobs no Postgres.
7. API pública de catálogo Neon usa cache de borda de 30 s; checkout recalcula preços sempre no servidor.
8. Eventos de pedido são curtos; histórico de preço registra apenas o campo alterado, em vez de duplicar todo o JSON do catálogo.
9. Migração separada em schema `dp`, índices limitados, nenhum usuário externo acessando banco. Manter Neon Data API pública desabilitada.
10. Recomendações: limitar uso de autoscaling e preview branches dentro do free tier; habilitar monitoramento de armazenamento, CU-h e egress; backups externos e teste de restauração antes de operação real.

## Criar e conectar o Neon pela Vercel
1. Acesse Vercel > Projeto `opanquecao` > Storage > Create Database ou Marketplace > Neon. Escolha um projeto dedicado exclusivamente ao Disk Panquecão. Verifique primeiro a modalidade Free e custos na tela antes de concordar.
2. Priorize região São Paulo caso esteja disponível para o plano/integração. Caso não, use a região mais próxima disponível e valide latência real. Não afirmar uma região sem confirmar.
3. Conecte produção e, se possível, prévias com branches separados; **não compartilhar o banco de produção com testes de CI**.
4. Verifique `DATABASE_URL` (pooler HTTP driver) e `DATABASE_URL_UNPOOLED` (migrações) injetados automaticamente. Configure `BACKOFFICE_PROVIDER=neon`; NÃO ATIVAR ainda.
5. Configure Neon Managed Auth e verifique `NEON_AUTH_BASE_URL` da integração. Restrinja cadastro de funcionários; contas devem ser convidadas e vinculadas a `dp.staff` com user_id efetivo.
6. Leia `scripts/neon-setup.cjs` e `neon/migrations/001_backoffice.sql`; execute `npm run db:neon:dry-run` primeiro. Depois, num ambiente administrativo seguro (NUNCA no navegador) defina `DATABASE_URL_UNPOOLED` e `NEON_SETUP_CONFIRM=opanquecao` e execute `npm run db:neon:setup` uma vez. Script não roda no deploy e não substitui dados existentes.
7. Confirme as 12 categorias e 82 produtos, tabela `dp.catalog`, testes de autenticação, idempotência, histórico e caixa com dados fictícios.
8. Crie o primeiro usuário Neon Auth e vincule o ID real: `INSERT INTO dp.staff(user_id,email,role,active) VALUES('ID_REAL','gestor@dominio.real','manager',true);` (exemplo de formato; substituir por ID/e-mail verdadeiros). Não use credenciais compartilhadas.
9. Após homologar, marque `BACKOFFICE_ENABLED=true` e `CATALOG_SOURCE=neon` apenas no ambiente de produção correto, e refaça o deploy. O checkout ativo passa a registrar pedidos no Neon antes do Telegram.

## Testar com SUA conta Asaas — somente Sandbox
1. A conta de produção Asaas NÃO é o ambiente de teste. Crie/acesse a **conta separada de Sandbox** em https://sandbox.asaas.com/ e gere uma API Key desse ambiente.
2. No projeto Vercel adicione como segredos de produção `ASAAS_SANDBOX_API_KEY` e `ASAAS_SANDBOX_WEBHOOK_TOKEN` (token aleatório >=32 caracteres), e `ASAAS_SANDBOX_ENABLED=true` somente após configurar o webhook. NÃO configurar `ASAAS_PRODUCTION_KEY` nem habilitar cobrança pública.
3. No Asaas Sandbox, configure webhook POST com URL `https://opanquecao.vercel.app/api/asaas-sandbox-webhook`. Autenticação: mesmo token aleatório em `authToken`; o Asaas o envia em `asaas-access-token`. Eventos: `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_EXPIRED` e `CHECKOUT_CANCELED`.
4. Faça login no backoffice com conta `manager`, abra **Caixa diário > Asaas — Checkout Sandbox** e clique **Criar checkout fictício de R$ 5,00**.
5. Abra o link gerado no Asaas e simule Pix ou cartão, conforme opções disponibilizadas no Sandbox. Consulte o status pela própria conta sandbox e atualize a aba Caixa no backoffice para conferir webhook.
6. Simule sucesso, cancelamento e expiração; confira duplicidade de eventos e que os valores NÃO entram no caixa diário, não liberam preparo, não alteram pedidos reais e não enviam `Purchase` ao Meta.
7. O retorno `/backoffice/asaas-return.html` é informativo: nunca usar `successUrl` como prova de pagamento. Só webhook autenticado pode avançar a simulação.
8. No MVP, por segurança, só existe checkout **fictício** no backoffice. O checkout Asaas para pedidos reais permanece propositalmente desativado até verificarmos taxas de entrega, conciliarmos pedido/pagamento, antifraude, estornos, idempotência e um lote de testes reais de homologação.

## Segurança e continuidade
- O banco usa schema privado `dp`; autenticação delegada a Neon Managed Auth, sessões HTTP-only e papel consultado no PostgreSQL. Se Auth/banco estiver indisponível, falhar fechado.
- Não expor `DATABASE_URL`, credenciais Asaas nem contatos de clientes em JS ou GitHub.
- Backup: Neon Free tem janela de recuperação curta; exportar cópia criptografada e testar restauração antes de atender pedidos reais. Definir retenção e acesso LGPD.
- Sem API pública aberta de escrita. A demonstração usa dados falsos e não chama endpoints administrativos.
- Os comandos de migração são operados manualmente e não são executados em cada build, evitando consumo e riscos.

XTL — Feito para durar. SECURE > STABLE > SIMPLE > SCALABLE.
