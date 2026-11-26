# XTL FOOD — fiscal, devoluções Pix e Campeões do Panquecão

Estado: fundamentos implementados, campanha 2027 não publicada, sem emissão fiscal ou transferência externa.

## Fiscal
- Solicitação por pedido avulso pago e concluído ou comanda fechada, sem duplicidade.
- O registro de solicitação não é uma nota fiscal. O módulo não gera documento fiscal fictício.
- Definir com a contabilidade o regime tributário, emissor autorizado, modelo fiscal aplicável, códigos dos produtos, certificado/credenciamento e CSC quando aplicável. Integrar autorização, rejeição, contingência, guarda do XML/DANFE e cancelamento/estorno fiscal conforme a operação.
- CPF fiscal é opcional quando permitido; o HMAC de identificação do cliente não é um CPF recuperável para emissão. Caso necessário, solicitar dado fiscal pelo canal adequado e protegido.
- Não adiar a emissão legal por causa da regra interna de pedido concluído: validar o momento correto de emissão antes de ativar.

## Pix
- Solicitação vinculada ao pedido original pago por Pix, com motivo e valor em centavos.
- Bloqueio transacional evita reservar valor de estorno acima do recebido, inclusive solicitações pendentes/incertas.
- Próximas etapas: identificador da transação original, conciliação com o provedor/banco, dupla verificação e aprovação de administrador autorizado, execução idempotente e confirmação por webhook/consulta autenticada. Não enviar um novo Pix a uma chave fornecida pelo cliente como substituto de devolução da transação original.
- Registrar ajustes de caixa e fidelidade sem apagar o pedido nem reabrir caixa fechado. Asaas técnico permanece exclusivo do superadministrador. A solicitação não movimenta dinheiro.

## Competição anual
- Proposta inicial: 01/01/2027 a 31/12/2027, horário America/Sao_Paulo. Campanha desativada por padrão.
- Três categorias: maior gasto em itens das categorias de panquecas (sem frete), maior número de compras, maior número de visitas presenciais com comanda fechada e consumo elegível. Uma comanda vale uma compra, não cada lançamento.
- Somente pedidos pagos e concluídos; estornos em aprovação, execução, confirmação ou estado incerto excluem conservadoramente o pedido até existir alocação de ajustes por item. Antes de publicar, tratar descontos PanqueCoins e devoluções parciais para refletir valores efetivamente pagos.
- Identificação única por cadastro com CPF vinculado. Participação voluntária, adesão com regulamento e retirada. Apelido pseudônimo por padrão; nome escolhido pelo participante somente com consentimento específico e revogável, separado da adesão à competição. Não divulgar CPF, telefone, valores, quantidades, horários ou histórico individual. Classificação por posição, empates em mesma posição.
- Prévia administrativa atualizada a cada cinco minutos; visualização pública/TV separada e instantâneos diários com fechamento anual ainda pendentes. Prêmio proposto para o primeiro colocado de cada categoria: um jantar individual com uma panqueca salgada, uma doce e um refrigerante. Definir tamanhos, sabores, regras de empate, acúmulo de categorias e prazo de retirada no regulamento. A publicação fica bloqueada sem referência de autorização e descrição do prêmio. Não anunciar nem iniciar antes de regularização junto à SPA.
- O ranking não altera o saldo PanqueCoins.
