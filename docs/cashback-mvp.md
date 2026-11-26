# PanqueCoins — programa de fidelidade Disk Panquecão
Status: **fundação em homologação, desativada por padrão**. Nenhum crédito financeiro ou desconto está ativo em produção.

## Regra proposta
- Fidelidade por customer_id (telefone normalizado no cadastro). O segundo pedido pago e entregue desbloqueia o programa e já gera 10%; demais pedidos elegíveis também geram 10%. Primeiro pedido não gera crédito retroativo.
- Contagem histórica de pedidos pagos e concluídos, inclusive retirada e consumo no local; cancelados e não pagos não contam. Não confundir com a regra de avaliação Google, exclusiva da terceira entrega.
- Crédito sobre produtos efetivamente pagos, sem frete e sem cashback usado. Inteiros em centavos, arredondamento para baixo. Crédito promocional, não sacável nem transferível.
- Validade até o fim do mês civil de geração (America/Sao_Paulo); saldo não acumula para o próximo mês. Fidelidade não reinicia a cada mês.
- Resgate em compra futura antes do vencimento, limitado ao subtotal de produtos e ao saldo; sem desconto automático sem consentimento. Cadastro/telefone não é autenticação para resgatar saldo publicamente.

## Identidade e modalidades de resgate
- Nome comercial obrigatório: **PanqueCoins**. Unidade promocional interna, não criptomoeda, não sacável, não transferível.
- Proposta de conversão: 1 PanqueCoin = R$ 1,00 de desconto; 0,01 PanqueCoin = R$ 0,01. Internamente, valores inteiros em centavos.
- Opção 1: descontar saldo de produtos em novo pedido elegível.
- Opção 2: acumular PanqueCoins dentro do mês para trocar por uma panqueca doce tamanho M. Proposta inicial: 25 PanqueCoins para qualquer sabor doce M elegível; limiar e sabores sujeitos à aprovação comercial antes da ativação. O catálogo estático consultado possui preços M de R$ 23 a R$ 30; o preço vigente deve ser consultado no Neon.
- A recompensa deve ser um item existente do catálogo (categoria panquecas-doces, variante M), com preço de tabela preservado e desconto registrado separadamente. Sem crédito sobre item resgatado; não combinar os dois resgates usando o mesmo saldo. Frete e adicionais não incluídos na recompensa.
- Exibir carteira, saldo disponível, vencimento e progresso até a recompensa. Informar no pós-venda somente benefícios efetivamente liberados.
- As duas opções usam o mesmo saldo, as mesmas reservas e expiração; não criar uma segunda moeda ou saldo duplicado.

## Fundação implementada
Migração 006: configuração desativada, créditos imutáveis por pedido, validade, contagem de pedidos elegíveis e trigger após pagamento + entrega, sem efeito sobre caixa. Não habilitar até implementar resgate. A geração usa subtotal integral porque ainda não existe desconto no checkout. Antes de habilitar, trocar base por subtotal líquido efetivamente pago e validar tratamento de estornos.

## Bloqueios de ativação
1. Aprovar as regras de expiração, resgate e margem comercial com os donos.
2. Implementar as duas modalidades de resgate (desconto e recompensa doce M), reservas e débitos transacionais FIFO por lote válido (incluindo expiração e liberação de reservas ao cancelar); nunca deixar saldo negativo. Vincular resgate ao pedido e registrar operador. Confirmar identidade do cliente antes de resgate.
3. Persistir desconto e total líquido e revisar recibo, checkout, WhatsApp, cálculo de troco, caixa diário, relatórios e estorno. Crédito não é receita nem pagamento em dinheiro.
4. Testar a migração e concorrência em branch Neon isolada, duas compras concorrentes, virada do mês, pagamentos antes/depois da entrega, cancelamento, reembolso e créditos duplicados. Não habilitar em produção antes de testes e aprovação.
5. Pós-venda informa saldo e validade somente após crédito efetivamente confirmado no banco. Nenhuma promessa de cashback antes de habilitar.
