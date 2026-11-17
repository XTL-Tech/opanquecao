# XTL Food — Checkout orientado e aumento ético de conversão (Fase 0.5)

**Objetivo:** facilitar a compra para pessoas sem familiaridade com sites. Reduzir erro, desistência e dúvidas, sem esconder taxas, falsificar avaliações ou induzir escolhas involuntárias.

## Aplicado neste PR
- O mesmo formulário de checkout foi organizado visualmente em **3 etapas** (recebimento/endereço, contato, pagamento/confirmação).
- Etapas continuam disponíveis sem JavaScript adicional, evitando bloqueios de validação HTML5 no Safari e leitores de tela.
- Botões *Continuar* validam os campos da seção e levam o foco à próxima etapa, sem enviar pedido.
- Indicador de progresso com `aria-current`, mensagens curtas e cabeçalhos semanticamente acessíveis.
- Preço e taxa não são substituídos por promessas artificiais; aviso explícito de que não há cobrança online.
- Preserva os campos, nomes, IDs, webhook Telegram, Turnstile, 82 produtos e demais dados do cliente.

## Psicologia de decisão permitida
1. **Redução de carga cognitiva:** agrupar a decisão que o usuário está tomando agora.
2. **Efeito de progresso:** tornar clara a próxima etapa sem barra artificial de porcentagem.
3. **Saliência:** evidenciar valor de envio, custo e limites da confirmação.
4. **Compromisso real:** escolhas feitas pela pessoa e consentimento voluntário; sem checkboxes pré-marcados.
5. **Confiança verificável:** mostrar somente o que é verdadeiro (o site envia pré-pedidos e a loja confirma).

**Proibido:** urgência de mentira, escassez fabricada, contagem de compradores sem dados, avaliações inventadas, adição automática de complementos ou ocultação de taxas.

## Testes e métricas seguintes
- Testar etapas no iPhone/Safari, Android/Chrome, 320–390 px, teclado e leitor de tela.
- Usar eventos agregados e consentidos sem PII para: `cart_open`, `checkout_delivery_selected`, `checkout_contact_started`, `checkout_payment_started`, `preorder_submit`, `preorder_confirmed`. Registrar **apenas** quando backend/privacidade estiverem aptos.
- Hipótese: reduzir abandono causado por erro em campos obrigatórios. Comparar % carrinho → envio aceito; **sem** inferir aumento de conversão antes de dados reais.
- Não ativar cobrança online nem alterar o fluxo de confirmação do Telegram nesta mudança.
