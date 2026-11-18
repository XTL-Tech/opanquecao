# XTL Food — Fase 1 / aprovação de pré-pedidos (homologação)

## Escopo preparado no código

- A operação antiga permanece INTACTA enquanto ORDER_APPROVAL_MODE não for "required".
- Com ORDER_APPROVAL_MODE="required" **e** ORDER_LEDGER_MODE="required", a API registra um pré-pedido em
  restaurant_preorder_reviews (nome/telefone/itens/endereço/pagamento) antes de avisar o Telegram.
- A comanda PDF preservada no Telegram recebe botões Aprovar e Rejeitar.
- Rejeitar abre escolhas de motivo predefinido; decisão atômica
  pending_review -> approved ou rejected. Só aceita IDs Telegram autorizados.
- Aprovar substitui o teclado por botão que abre WhatsApp do cliente com mensagem pré-preenchida;
  a mensagem NÃO é enviada automaticamente. Rejeitar deixa o motivo persistido.
- Cliente que mantém a página aberta vê status e motivo na tela, consultando endpoint privado
  POST /api/order-status com token aleatório de 256 bits salvo na sessionStorage (nunca na URL).
- Telegram webhook POST /api/telegram-review só aceita cabeçalho secreto + chat e ID autorizados.
- Timeout/indisponibilidade não disparará um segundo Telegram automaticamente: retorna 202 e
  exige conferência, preservando a idempotência do pedido.
- Migration 005 cria tabela privada com RLS e sem grants para anon/authenticated e
  UNIQUE (restaurant_id,order_ref) para detectar colisão do código curto de oito caracteres.

## O que esta implementação NÃO faz ainda

- Não há banco exclusivo Disk Panquecão no Supabase conectado. Nenhuma migration foi executada.
- Nenhuma credencial de Telegram ou banco foi inserida, nem um webhook externo foi registrado.
- Não existe Web Push real: cliente com site fechado não recebe notificação do sistema.
- Não existe painel administrativo autenticado para personalizar texto do motivo, operador ou horários.
- A rejeição real oferece motivos predefinidos; motivos livres aguardam backoffice.
- Após fechar completamente a aba, o token da sessionStorage pode desaparecer. Na versão atual
  é necessário acompanhar enquanto a aba está aberta ou entrar em contato com a loja.
- O recebimento do PDF/Telegram não significa que a loja APROVOU o pedido.
- A configuração de horários da PR #19 também continua independente do módulo de aprovação.

## Habilitação segura em Preview (NÃO executar na produção antes da homologação)

1. Confirmar em qual ORGANIZAÇÃO Supabase da conta XTL criar a base exclusiva "xtl-food-panquecao".
   Projeto em sa-east-1, custo confirmado antes de criar. Nunca reutilizar base do XTL Core, Jarbas ou LinkSul.
2. Executar migrations 001-005, em ordem, conferir catálogo e regras RLS, e testar os advisors.
   O CLI Supabase não está instalado no ambiente de implementação; arquivos SQL foram preparados
   respeitando a sequência atual, sem afirmar que são migrations aplicadas.
3. Usar um BOT e GRUPO Telegram de teste, diferentes da operação comercial vigente.
   Um bot tem um webhook principal: não apontar um bot já usado em produção para o preview.
4. Na Vercel **somente no ambiente Preview** fornecer os segredos server-side:
   SUPABASE_URL, SUPABASE_SECRET_KEY, ORDER_LEDGER_MODE=required,
   ORDER_APPROVAL_MODE=required, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
   TELEGRAM_WEBHOOK_SECRET (aleatório, não publicar), TELEGRAM_REVIEWER_IDS
   (IDs numéricos do Telegram dos atendentes; não é o ID do grupo),
   TURNSTILE_SECRET_KEY e a configuração pública do site key.
5. Configurar setWebhook no bot de teste para URL exclusiva da função
   /api/telegram-review, com o mesmo secret_token configurado no ambiente Preview.
   O segredo do webhook não é o token de acesso ao bot.
6. Executar a matriz E2E: pré-pedido fictício chega ao bot; aprovação e texto WhatsApp;
   rejeição com motivo; cliente acompanha status; duplo clique; não autorizado; grupo
   incorreto; falha do banco; Telegram fora do ar; fechamento da loja; telefone errado.
   Testar Android Chrome e iPhone Safari.
7. Registrar revisão de segurança, auditoria, custos e plano de rollback. Só então aprovar
   merge e habilitar a integração em produção em janela controlada.

## Variáveis e regras de segurança

- Todos os endpoints de cliente usam Cache-Control: no-store.
- SUPABASE_SECRET_KEY nunca vai para frontend; somente funções server-side.
- Token de status é hash SHA-256 no banco; o cliente guarda somente o token bruto de sua
  sessão, que é entregue APENAS na resposta à criação do pedido.
- O botão Telegram não é autenticação suficiente; só o webhook correto, chat correto,
  atendente numa allowlist e atualização condicional permitem mudar o status.
- Não confiar em nome, valor, frete ou horário declarados pelo navegador.
- O ID curto do cupom não pode servir como autenticação para consultar pedidos.

## Rotas e fluxo de decisão

POST /api/order
  -> validações + Turnstile + ledger -> restaurante_preorder_reviews.pending_review
  -> sendDocument Telegram (Approve/Reject) -> vincula message_id -> resposta ao cliente

POST /api/telegram-review
  -> valida header secret/chat/operador -> CAS status pending_review -> approved/rejected
  -> atualiza teclado Telegram -> WhatsApp pré-preenchido somente se aprovado

POST /api/order-status
  -> requestId + trackingToken (corpo JSON) -> status/reason sem dados pessoais.

## Rollback

Desabilitar ORDER_APPROVAL_MODE no Preview restaura o modo anterior sem remover a tabela.
Não apagar dados de pré-pedidos nem desativar o bot de produção. Em caso de falha no banco
com modo obrigatório, o fluxo falha fechado (não simular aprovação e não enviar pedidos
não registrados). Backups, retenção, recuperação e suporte humano devem ser aprovados
antes de operar com clientes reais.

Referências: PR demonstrativa #22, roadmap #15 e regras de horário PR #19.
