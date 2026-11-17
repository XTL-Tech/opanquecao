# XTL Food — horários, abertura excepcional e avisos de reabertura

## Estado da implementação — 17/11/2026

Branch de homologação. **Não publicada em produção e nenhuma notificação push enviada.**
O site atual continua operando em modo legado enquanto `STORE_HOURS_MODE` não for configurado como `required`.
A branch prepara a consulta `GET /api/store-status`, popup acessível de loja fechada e bloqueio de novos pedidos no **servidor** quando o expediente estiver desativado.

Não inventar os horários do Disk Panquecão: a loja deve aprovar os dias e intervalos antes de ligar o bloqueio.

## Regra operacional

- Fonte única de verdade: `restaurant_operations` no Supabase EXCLUSIVO do restaurante.
- Fuso `America/Sao_Paulo` na API, nunca hora do telefone do cliente.
- `accepting_orders=false` é parada de emergência: prevalece sobre qualquer outra opção.
- `manual_state=open/closed` permite abrir fora do expediente ou fechar durante ele, mas somente até `manual_override_until`; depois volta à programação.
- `manual_state=auto` aplica a agenda quando `enforce_opening_hours=true`.
- `weekly_schedule`: objeto de dias JS 0 (domingo) a 6 (sábado), cada dia com intervalos `[{ "start":"19:00","end":"23:00" }]`. Exemplo **ilustrativo**, NÃO horário oficial.
- `holiday_exceptions`: objeto `YYYY-MM-DD` para intervalos daquele dia. Array vazio significa fechado. Exceção prevalece sobre agenda semanal.
- Janelas são do mesmo dia, início inclusivo e fim exclusivo. Se cruzar meia-noite, dividir em dois dias.
- Com agenda vazia e enforcement ligado, a loja fica fechada até que o gestor configure o horário.
- Erro de conexão/configuração: o checkout fica indisponível; o menu continua visível.
- Popup aparece ao visitante enquanto fechada e pode ser dispensado sem impedir consulta ao cardápio.
- O bloqueio do servidor é obrigatório; bloquear apenas o botão seria contornável.

## Avisos de reabertura (escopo aprovado, ainda não ativado)

Requisito: ao visitar a loja fechada, o cliente pode **optar** por ser avisado em futuras reaberturas. O aceite precisa ser distinto do consentimento para fazer um pedido.

**Não solicitar permissão do navegador ao abrir o popup.** A permissão nativa deve ser solicitada após o toque em "Quero receber avisos". Usar Web Push, Service Worker, VAPID e banco isolado para guardar assinaturas; oferecer cancelamento a qualquer momento, política de retenção e política de privacidade clara.

A inscrição deve ter duas condições: permissão do sistema operacional + confirmação de gravação pelo servidor. Sem ambas, nunca exibir "avisos ativados". Evitar recolher telefone/e-mail desnecessariamente.

A abertura gera um evento idempotente `store_opened` **somente na transição fechada → aberta** (agenda ou abertura manual). A fila durável registra um evento por transição, e a entrega push ocorre em processamento separado, com tentativas limitadas e limpeza de inscrições expiradas. Visitar a página, atualizar o navegador ou executar o monitor várias vezes não devem gerar novas notificações. Reaberturas futuras podem disparar novos avisos enquanto a inscrição continuar ativa.

Na publicação, exibir "Quero ser avisado quando abrir" somente se o fluxo completo de inscrição **e envio** estiver funcionando. Até lá `canSubscribe:false` e nenhum falso aceite.

**iOS/iPadOS:** Web Push é oferecido a web apps adicionados à tela de início em iOS 16.4+ (não presumir suporte em uma aba comum do Safari). Android e navegadores compatíveis exigem HTTPS e permissão do usuário. Não é possível garantir entrega "sempre": sistemas podem bloquear notificações, cortar entrega ou a inscrição pode expirar. Documentação: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

## Falta para produção

1. Projeto Supabase dedicado do Panquecão (não usar bases XTL Core/ID ou Jarbas), migrações 001–004, teste da tabela e regras RLS.
2. Aprovação dos horários de funcionamento, feriados e regras de exceção; registrar operador da alteração.
3. Backoffice com autenticação/autorizações e trilha de auditoria para "Abrir agora", "Fechar agora", "Voltar ao automático" e edição dos horários. **Ainda não implementado.** Até lá, não expor credencial administrativa no site.
4. Web Push: inscrição, cancelamento, Service Worker, manifesto PWA, VAPID, tabela protegida, worker de disparo, fila, deduplicação e observabilidade. **Ainda não implementado.**
5. Integração do fluxo pendente de **aprovar/rejeitar** pedidos via bot Telegram com atualização do status para o cliente; não confundir "enviado ao Telegram" com "aprovado".
6. Testes em preview: fora/dentro do expediente, horário de verão (se houver mudança), manual open/closed, falha de banco, pedido direto à API, iOS instalado, Android, desinscrição, transições repetidas e ausência de spam.
7. Somente após homologação e aceite, `STORE_HOURS_MODE=required` no Preview e posteriormente Production; nunca habilitar sem banco e agenda.

## Migração e rollback

Migração 004 adiciona campos de override a `restaurant_operations` e auditoria privada. Não alterar catálogo, preços, imagens, pagamentos, pedidos existentes ou credenciais. Modo legado permanece inalterado se `STORE_HOURS_MODE` não for `required`; desligar flag é rollback deliberado, não fallback automático de banco indisponível.
