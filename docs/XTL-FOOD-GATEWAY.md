# XTL Food — Gateway privado de homologação

## Arquitetura
Frontend cliente → Vercel `POST /api/order` (Turnstile, preços, dados) → gateway assinado XTL Food (Supabase Edge) → somente tabelas `restaurant_*` do restaurante `opanquecao`.
Webhook Telegram → backend Vercel (secret + chat + operador) → gateway assinado → atualização condicional do status → cliente acompanha pelo token privado.

## Assinatura
- Node usa chave privada Ed25519 no ambiente do servidor `FOOD_GATEWAY_PRIVATE_KEY_B64` (PKCS8 DER base64). Nunca incluir em Git, navegador, logs ou mensagens.
- Gateway usa SOMENTE chave pública em `FOOD_GATEWAY_PUBLIC_KEY_B64` (SPKI DER base64, variável Supabase Edge).
- Corpo JSON SHA-256 e timestamp milissegundos assinados com Ed25519, janela de 45 segundos. HTTPS, `POST` apenas. Requisições sem chave válida são recusadas.
- Idempotência e transições atômicas impedem efeitos duplicados de requisição repetida. O gateway aceita exclusivamente ações nomeadas; nenhuma consulta SQL nem nome de tabela vem do chamador.

## Escopo e segurança
- A Vercel NÃO recebe `SUPABASE_SECRET_KEY` ou `service_role` do banco compartilhado. O código rejeita a presença dessa variável.
- A função Edge usa a credencial global interna do próprio projeto Supabase para operações *explicitamente permitidas* pelo gateway, conferindo o restaurante e limites de campos. **Isso não executa queries com o papel NOLOGIN `xtl_food_runtime` e não substitui auditoria ou isolamento por papel próprio**.
- Para maior defesa, migrar o Edge para uma conexão PostgreSQL usando `xtl_food_runtime` com login restrito após provisionar credencial, pooler e TLS; e estudar isolamento físico quando houver escala.
- Falhas no gateway impedem pedidos sem registro. Todos os tokens e dados pessoais permanecem no servidor; cliente consulta apenas status e motivo via token aleatório.
- Não ativar serviço sem chave pública cadastrada, chave privada branch-specific, rate limiting, logs sem PII, bot Telegram HML separado, verificações de gateway, procedimentos de back-up e rollback.

## Implantação segura
1. Criar par Ed25519 por ambiente de forma segura: `openssl genpkey -algorithm Ed25519 -out food-hml.pem`. Exportar chave privada DER PKCS8 para variável ENCRYPTED da Vercel Preview **somente da branch de homologação**. Exportar chave pública DER SPKI para variável da função Edge `FOOD_GATEWAY_PUBLIC_KEY_B64`. Nunca compartilhar a chave privada.
2. Variáveis Vercel Preview na branch: `FOOD_DB_TOPOLOGY=shared`, `SUPABASE_URL=https://oksafggcaotekrvwvqgg.supabase.co`, `FOOD_GATEWAY_URL=https://oksafggcaotekrvwvqgg.supabase.co/functions/v1/xtl-food-gateway`, `FOOD_GATEWAY_PRIVATE_KEY_B64` (sensitive), `ORDER_LEDGER_MODE=required`, `ORDER_APPROVAL_MODE=required`, e `STORE_HOURS_MODE` somente após horários reais cadastrados.
3. Configurar grupo e bot Telegram **HML exclusivos**; não reutilizar webhook do bot de produção. `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_REVIEWER_IDS` e Turnstile HML separados; manter a API protegida.
4. Confirmar conexão Git da conta `opedrososamuel@gmail.com` com `XTL-Tech/opanquecao` na Vercel. Em 18/11/2026, criação de projeto HML falhou porque a integração GitHub não estava instalada nessa conta.
5. Executar E2E com pedidos fictícios, callbacks autorizados/negados, falha de banco, Telegram incerto, rejeição, leitura do cliente, horários e notificações. Documentar backup e recuperação.
6. Nunca habilitar produção sem revisão de RLS, vazamento de segredo, testes reais com dispositivos, retenção LGPD e aprovação da loja.

## Limitações atuais
- Código, transporte e testes automatizados são preparados em PR. A chave pública Supabase e a chave privada Vercel ainda não foram provisionadas, portanto o gateway rejeita chamadas; não há pedidos reais.
- As notificações Web Push de reabertura e o backoffice autenticado ainda aguardam implementação.
- A PR é baseada no fluxo da PR #24; mesclagem em `main` e ativação ficam bloqueadas até homologação.
