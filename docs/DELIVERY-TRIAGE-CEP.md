# Triagem de endereço / taxa — CEP geral dos municípios

**Correção de regra de negócio:** em Nova Hartz e Araricá o CEP é predominantemente um **CEP de localidade**, não uma chave confiável para identificar rua, bairro ou distância. Nova Hartz tem CEP geral 93890-000 e CEP de localidade Campo Vicente 93893-000; Araricá tem CEP geral 93880-000. Há também CEPs especiais de unidades postais. Não bloquear uma entrega por bairro incompatível com a descrição de um CEP especial.

O módulo `lib/delivery-triage.js` usa o CEP **apenas para verificar município/UF**:
- 93890-000/93893-000 = Nova Hartz; 93880-000 = Araricá. Essas consultas são locais, sem enviar CEP a terceiros.
- Outros CEPs podem consultar ViaCEP somente com os oito dígitos. Se o serviço estiver indisponível, marcar indeterminado — não rejeitar apenas pela falha externa.
- Caso o CEP aponte para **outra cidade**, marcar `needs_review` e taxa `null` (confirmar com o cliente), sem preço final garantido.
- Rua, número, referência e bairro são informados pelo comprador e precisam ser conferidos; o CEP **nunca** prova que a entrega está naquele bairro.
- GPS é opcional, exige permissão do cliente e só pode alimentar uma estimativa por distância se o cliente também confirmar que **é o destino da entrega**; isso ainda não é feito pelo checkout atual. Não presumir que localização do dispositivo é a casa do cliente.
- O cálculo por distância está **desligado**. Precisa de origem física da loja verificada, tarifas aprovadas pelo estabelecimento e `DELIVERY_DISTANCE_PRICING=enabled`. Faixas usam distância em linha reta como estimativa inferior, não equivalem a percurso real de moto.
- Padrões atuais permanecem R$ 7 em Nova Hartz, R$ 10 em Araricá para bairros configurados; localidade divergente ou fora da cobertura exige confirmação antes da aceitação. **Não realizar cobranças automáticas adicionais sem aceite informado do comprador.**

## Passo para Backend Fase 1
Adicionar registro durável do endereço geocodificado com consentimento, coordenadas do destino confirmado, origem da loja, cálculo de rota (via roteador licenciado), política de tarifas versionada e trilha de decisão. O checkout exibirá o custo final antes de confirmar o pré-pedido, e nenhuma tarifa será recalculada unilateralmente após o envio.

## Escopo da PR
Apenas triagem reutilizável + documentação + testes; **não altera tarifa, pedidos em produção, localização da loja ou as variáveis da Vercel**.
