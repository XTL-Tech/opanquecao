# XTL Food — WhatsApp de homologação (Meta Cloud API)

**Ambiente:** projeto Vercel separado `disk-panquecao-hml`; não publicar em `opanquecao.vercel.app`. A API oficial de teste da Meta permite mensagens reais para **destinatários previamente verificados**; os testes não usam WhatsApp Web nem o número comercial.

## Implementação desta branch

- `GET /api/wa-hml-webhook`: valida o desafio de inscrição da Meta via `WA_HML_VERIFY_TOKEN`.
- `POST /api/wa-hml-webhook`: valida o corpo bruto com HMAC-SHA256 e a chave `WA_HML_APP_SECRET`; rejeita assinatura inválida. Registra evento recebido (`received`) e status (`sent`, `delivered`, `read`) sem nomes, telefones ou textos. Os identificadores são resumidos por SHA-256.
- `POST /api/wa-hml-send`: protegido por `WA_HML_TRIGGER_KEY`, envia apenas para o destinatário fixo `WA_HML_TEST_RECIPIENT`, por número de teste da Meta. Aceita apenas `type: hello_world` ou `type: order`. Pedido contém **TESTE — NÃO PREPARAR** e identificador de homologação. Não aceita destinatário ou texto arbitrário da requisição.
- `npm run test:wa-hml`: testes sem envio real, incluindo assinatura, manipulação do corpo, autenticação, redigir dados pessoais, recebimento e erros da API.

## Configurar no Meta for Developers

1. Acesse https://developers.facebook.com/apps/ e crie/selecione um app com caso de uso **WhatsApp Business Platform / Cloud API** no portfólio de testes da XTL.
2. No painel de configuração da API, selecione o **número de teste** fornecido pela Meta. Cadastre um número de WhatsApp de sua propriedade como destinatário autorizado e **confirme-o por código**; não use número de cliente nem o número comercial da loja.
3. Anote o **Phone Number ID** do número de teste (não confundir com o número visível ou WABA ID). Obtenha o token de acesso próprio para testes. O token temporário expira; para continuidade, utilize usuário de sistema e token apropriado.
4. Em **Meta App Settings / Basic**, obtenha o **App Secret**. Em Webhooks, crie um Verify Token **aleatório e diferente**.
5. No Vercel, cadastre as variáveis a seguir **somente no projeto de homologação**, sem colar os valores no GitHub ou em conversa:
   - `WA_HML_VERIFY_TOKEN`: token aleatório escolhido para validar o GET.
   - `WA_HML_APP_SECRET`: App Secret da Meta (assinaturas POST).
   - `WA_HML_PHONE_NUMBER_ID`: Phone Number ID do número de **teste** da Meta.
   - `WA_HML_ACCESS_TOKEN`: token da Cloud API com permissão para enviar.
   - `WA_HML_TEST_RECIPIENT`: somente dígitos do número **autorizado**, incluindo país e DDD.
   - `WA_HML_TRIGGER_KEY`: segredo aleatório de no mínimo 32 caracteres para disparo de teste.
   - `WA_HML_GRAPH_VERSION`: opcional; padrão `v26.0`; conferir a versão suportada pelo aplicativo.
6. **Atenção — ambiente privado:** o projeto Vercel HML utiliza Vercel Authentication. A Meta **não** consegue acessar a URL protegida diretamente. Em **Settings → Deployment Protection → Protection Bypass for Automation**, habilite um segredo de bypass, preservando a proteção geral. Cadastre na Meta a Callback URL com o parâmetro `x-vercel-protection-bypass` (segredo da Vercel) e o Verify Token:
   `https://disk-panquecao-hml.vercel.app/api/wa-hml-webhook?x-vercel-protection-bypass=SEU_SEGREDO_VERCEL`
   O segredo vai **somente no painel Meta**, não no código ou nos logs. A Meta acrescentará os parâmetros de verificação ao GET.
7. Inscreva o webhook no campo `messages` do objeto `whatsapp_business_account` para receber mensagens e status. A URL é `/api/wa-hml-webhook` no projeto HML.

## Executar testes reais — após credenciais e webhook verificado

Envie uma única mensagem usando cliente HTTP autorizado (cURL/Postman) ao endpoint de homologação. A chave de disparo fica em cabeçalho, nunca em URL nem na versão pública do site:

```sh
curl -X POST 'https://disk-panquecao-hml.vercel.app/api/wa-hml-send' \
  -H 'Content-Type: application/json' \
  -H 'x-vercel-protection-bypass: SEU_SEGREDO_VERCEL' \
  -H 'x-xtl-wa-hml-key: SUA_WA_HML_TRIGGER_KEY' \
  -d '{"type":"hello_world"}'
```

O destino é fixado no servidor. A resposta HTTP `202` significa **aceito pela Meta, ainda não entregue**. Confira a mensagem recebida no WhatsApp do aparelho autorizado, depois responda na conversa para abrir a janela de atendimento de 24h. Então repita com `-d '{"type":"order"}'`. O texto inclui identificador `XTL-HML-...` e exemplos de produtos sem dados reais.

Confira nos logs do **projeto de homologação** os eventos `XTL_WA_HML_WEBHOOK`. Para validar:

- Evento de status `delivered` referente ao mesmo `messageIdHash` que a resposta do envio.
- Evento `received` quando você responder pelo WhatsApp ao número de teste; se incluir o marcador `XTL-HML-...` na resposta, ele será identificado no log.
- O aparelho mostra o recebimento. Evento `read` é adicional, não garantido (confirmações de leitura podem estar desativadas).
- Não registrar informações sensíveis no painel, não simular confirmações reais e nunca marcar como "entregue" só por receber um HTTP 200/202 da Cloud API.

## Limites e estado

Este código por si só **não** comprova envio/recebimento real. Até configurar app Meta, variáveis seguras, callback externo e realizar mensagem autenticada, apenas os **testes simulados** foram executados. Os webhooks registram evidência nos logs Vercel, não persistem histórico consultável. Para automação recorrente de ponta a ponta, adicionar armazenamento HML com retenção e política de acesso e agendamento **após** validação manual inicial.

Referências:
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection
