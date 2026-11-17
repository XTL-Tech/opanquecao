# Idempotência de pré-pedidos — XTL Food

## Situação

Este PR é **dependente do PR #6**, que prepara um projeto Supabase **exclusivo** do Panquecão. A solução não pode ser habilitada em produção antes de haver uma base dedicada, migrations aplicadas, teste de webhook fictício e aprovação de liberação.

## Problema e solução

Cada tentativa de checkout tem um UUID v4 aleatório, que o navegador reutiliza em solicitações repetidas. Sempre que disponível, o navegador preserva apenas o UUID e um SHA-256 da intenção no **sessionStorage** por até 30 minutos; nenhum nome, telefone ou endereço é persistido por esse mecanismo. Sem WebCrypto sutil, usa apenas memória volátil.

No servidor, quando **ORDER_LEDGER_MODE=required**, cada pedido é registrado por chave primária PostgreSQL `(restaurant_id,request_id)` ANTES do envio ao Telegram. A tabela guarda somente chave, hash do conteúdo, referência, status e id da mensagem; **não armazena dados pessoais**. O uso de `ON CONFLICT DO NOTHING` via PostgREST impede que duas execuções concorrentes assumam a mesma tentativa.

- **Novo pedido**: valida catálogo e Turnstile, cria o registro durável `processing`, gera a comanda e envia ao Telegram. Confirma `delivered`.
- **Mesmo UUID, conteúdo idêntico, entregue**: devolve o mesmo protocolo sem reenviar.
- **Mesmo UUID, conteúdo diferente**: erro HTTP 409, sem reenviar.
- **Em processamento/resultado ambíguo**: devolve HTTP 202 e instrução para conferir com a loja, sem reenviar.
- **Banco fora do ar ou sem credenciais**: erro HTTP 503 e nenhuma tentativa nova de envio (modo estrito).
- **Timeout ou falha no Telegram**: estado `needs_review` e HTTP 202. Não há retry automático.

**Limite real**: Telegram não disponibiliza uma transação distribuída com o PostgreSQL. Se o processo cair após o envio e antes de marcar `delivered`, a linha ficará em `processing`; haverá necessidade de reconciliação manual. O mecanismo evita reenvio automático, mas não promete entrega exatamente uma vez em todas as falhas possíveis.

## Ativação

1. Criar o projeto Supabase exclusivo do restaurante após validação de custo e titularidade.
2. Aplicar `202611170001_initial_catalog.sql`, `202611170002_seed_catalog.sql` e `202611170003_order_intents.sql`, nessa ordem. Verificar RLS, tabela vazia e consulta de leitura com credencial somente servidor.
3. Configurar em **Vercel Preview apenas**:
   - `SUPABASE_URL` (host da base exclusiva).
   - `SUPABASE_SECRET_KEY` (chave de servidor, jamais enviada ao navegador, nem registrada em Git).
   - `ORDER_LEDGER_MODE=required` para o teste de segurança.
   - Variáveis existentes do Telegram e Turnstile **de homologação**.
4. Executar `npm ci && npm test`. Testar pedidos fictícios: clique duplo, reenviar, atualizar a página, concorrência, Telegram indisponível, Supabase indisponível e troca de dados.
5. Aprovado o Preview, configurar as variáveis com escopo Production e **redeploy com aprovação manual**.
6. Acompanhar linhas `processing` com mais de 2 minutos e `needs_review`; operadores devem conferir no Telegram antes de decidir pelo contato com o cliente. Nunca marcar como reenviado automaticamente.

## Desativação segura

- `ORDER_LEDGER_MODE` ausente ou diferente de `required` mantém a operação legada. **Não usar o modo legado como failover automático quando o banco falhar**, pois isso perderia a barreira contra duplicações.
- Desativar intencionalmente somente por rollback aprovado e comunicar ao operador a redução da proteção.
- A migration não altera tabelas de cardápio, pedidos antigos nem informações de outros clientes.

## Segurança e desempenho

- A tabela tem RLS ativada e não possui políticas públicas. Chaves secretas só no backend; nunca em `NEXT_PUBLIC_*` ou HTML.
- Uma consulta ao ledger para a tentativa e uma gravação de conclusão, sem polling contínuo.
- O navegador não dispara novas tentativas sem interação direta.
- Após implantação, medir p95 e contagem de tentativas duplicadas; não executar teste de carga contra o Telegram real.
