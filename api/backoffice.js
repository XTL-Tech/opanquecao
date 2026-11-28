'use strict';
// XTL / Disk Panquecão: todas as operações com PII acontecem no servidor.
const {randomUUID}=require('node:crypto');
const c=require('../lib/backoffice-core');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const areas=require('../delivery-areas.json');

function respond(res,status,payload){return res.status(status).json(payload);}
function requireId(id){if(!c.UUID.test(id))c.fail('Identificador de pedido inválido.');return id;}
function payload(req){
 const body=req.body||{};
 if(typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>30000)
   c.fail('Dados inválidos ou muito extensos.');
 return body;
}
async function action(req,actor,body){
 const a=body.action;
 if(a==='customer_save'){
  const data={name:c.name(body.name),phone:c.phone(body.phone),notes:c.note(body.notes)};
  if(body.id){
   const result=await db.updateCustomer(requireId(body.id),data);
   return {customer:result};
  }
  const customer=await db.upsertCustomer(data);
  if(data.notes)await db.updateCustomer(customer.id,{notes:data.notes});
  return {customer};
 }
 if(a==='manual_order'){
  const customer=await db.upsertCustomer({name:c.name(body.name),phone:c.phone(body.phone)});
  const fulfillment=(await import('../fulfillment.mjs')).normalizeFulfillment(body.fulfillment,areas);
  const catalog=(await db.getCatalog()).catalog;
  if(!catalog)throw new db.StoreError('Catálogo indisponível.');
  const {priceOrder}=await import('../order-catalog.mjs');
  const items=priceOrder(catalog,body.lines);
  const result=await db.createOrder({
   requestId:randomUUID(),customer,items,fulfillment,
   note:c.note(body.note,400),origin:'manual',status:'awaiting_acceptance',
   telegramState:'not_applicable'
  });
  return {order:result.record};
 }
 if(a==='order_status'){
  const id=requireId(body.id),order=await db.getOrder(id);
  if(!order)throw new db.StoreError('Pedido não encontrado.',404);
  if(!c.statusAllowed(order.status,body.next))c.fail('Transição de pedido inválida. Atualize a tela.');
  if(body.next==='accepted'&&order.fulfillment?.type==='delivery'&&order.delivery_fee_cents===null)
   c.fail('Confirme o valor da entrega antes de aceitar o pedido.');
  if(body.next==='cancelled'&&order.payment_status==='paid')
   c.fail('Pedido já pago. Não é permitido cancelar sem procedimento de estorno.');
  const change={status:body.next,updated_by:actor.id};
  if(body.next==='accepted')change.accepted_at=new Date().toISOString();
  if(body.next==='delivered')change.delivered_at=new Date().toISOString();
  return {order:await db.patchOrder(id,{
   status:'eq.'+order.status,
   ...(body.next==='cancelled'?{payment_status:'eq.pending'}:{})
  },change)};
 }
 if(a==='order_fee'){
  const id=requireId(body.id),order=await db.getOrder(id);
  if(!order)throw new db.StoreError('Pedido não encontrado.',404);
  if(order.fulfillment?.type!=='delivery'||!['pending_customer','awaiting_acceptance'].includes(order.status)||order.payment_status!=='pending')
   c.fail('Taxa só pode ser definida antes do aceite da entrega.');
  const fee=c.cents(body.feeCents,10000);
  return {order:await db.patchOrder(id,{
    status:'eq.'+order.status,payment_status:'eq.pending',
    delivery_fee_cents:order.delivery_fee_cents===null?'is.null':'eq.'+order.delivery_fee_cents
   },{delivery_fee_cents:fee,updated_by:actor.id})};
 }
 if(a==='order_paid'){
  const id=requireId(body.id),order=await db.getOrder(id);
  if(!order)throw new db.StoreError('Pedido não encontrado.',404);
  if(!['accepted','completed','delivered'].includes(order.status)||order.payment_status!=='pending')
   c.fail('Pagamento só pode ser confirmado em pedido aceito e ainda não pago.');
  if(!c.METHODS.includes(body.method))c.fail('Selecione a forma de pagamento recebida.');
  if(c.orderTotal(order)===null)c.fail('Defina a taxa de entrega antes de registrar o pagamento.');
  if(body.received!==true)c.fail('Confirme que o pagamento foi realmente recebido.');
  return {order:await db.patchOrder(id,{status:'eq.'+order.status,payment_status:'eq.pending'},
    {payment_status:'paid',payment_method:body.method,paid_at:new Date().toISOString(),updated_by:actor.id})};
 }
 if(a==='cash_close'){
  const today=c.businessDate(),date=c.isoDate(body.date);
  if(date!==today)c.fail('Só é permitido fechar o caixa da data atual.');
  const value=c.cents(body.countedCashCents,100000000);
  return {closing:await db.closing({
   today,counted:value,notes:c.note(body.notes),userId:actor.id
  })};
 }
 if(a==='catalog_price'){
  if(actor.role!=='manager')throw new auth.AuthError('Somente a gestão pode alterar preços.',403);
  if(typeof body.category!=='string'||typeof body.product!=='string'||typeof body.variant!=='string')
   c.fail('Seleção de produto inválida.');
  return {catalog:await db.changePrice({
   category:body.category,product:body.product,variant:body.variant,
   priceCents:c.cents(body.priceCents),revision:body.revision,actorId:actor.id
  })};
 }
 throw new db.StoreError('Ação desconhecida.',404);
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const method=req.method||'GET';
  const act=method==='GET'?String(req.query?.action||'status'):req.body?.action;
  if(method==='GET'&&act==='status')return respond(res,200,{enabled:db.configured()&&auth.configured(),provider:'neon'});
  if(!['GET','POST'].includes(method))return respond(res,405,{error:'Método inválido.'});
  if(method==='POST')auth.originGuard(req);
  if(method==='POST'&&act==='logout'){
   await auth.logout(req,res);return respond(res,200,{ok:true});
  }
  if(!db.configured()||!auth.configured())throw new db.StoreError('Backoffice Neon/Auth ainda não configurado para uso real.');
  if(method==='POST'&&act==='login'){
   const actor=await auth.login(req,res,payload(req));
   return respond(res,200,{actor});
  }
  if(method==='POST'&&act==='request_otp')
   return respond(res,200,await auth.requestOtp(payload(req)));
  if(method==='POST'&&act==='login_otp')
   return respond(res,200,{actor:await auth.loginOtp(req,res,payload(req))});
  const actor=await auth.actor(req);
  if(method==='GET'){
   if(act==='dashboard')return respond(res,200,{actor,...await db.dashboard()});
   if(act==='catalog')return respond(res,200,{catalog:await db.getCatalog()});
   if(act==='customers')return respond(res,200,{customers:await db.searchCustomers(req.query?.term,req.query?.cursor||0)});
   if(act==='orders')return respond(res,200,{orders:await db.searchOrders({term:req.query?.term,status:req.query?.status,before:req.query?.before,beforeId:req.query?.beforeId})});
   if(act==='events')return respond(res,200,{events:await db.events(requireId(req.query?.id))});
   if(act==='franchise_plan'){
    if(actor.role!=='manager')throw new auth.AuthError('Acesso restrito à gestão.',403);
    res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    return respond(res,200,{plan:"PLANO DE FRANQUIAS — O PANQUECÃO | DISK PANQUECÃO\nDP-FRAN-001 · v0.1 · 27/11/2026 · CONFIDENCIAL — USO DA GESTÃO\nEstudo preliminar, não é COF, oferta, contrato ou promessa de retorno. Não autorizado para distribuição a candidatos. Valores são hipóteses de trabalho, sem dados financeiros auditados.\n\n1. VISÃO E POSICIONAMENTO\nReplicar a experiência de gastronomia familiar originada em Nova Hartz: panquecas, lasanhas de massa de panqueca, frango frito crocante e açaí, com hospitalidade local. História informada pela família: início com chapa doada, R$ 500 em ingredientes, dez anos e mais de cinco mil clientes recorrentes. Validar números e direitos de uso da marca antes da divulgação comercial.\n\n2. FORMATOS PROPOSTOS\nA — Express: produção enxuta, delivery e retirada, área referencial 35–65 m², equipe inicial 3–5 pessoas por operação conforme escala. Cardápio compacto; validar capacidade de chapa, fritura e refrigeração.\nB — Família: salão, delivery e retirada, área referencial 80–150 m², equipe inicial 5–9 conforme escala. Espaço de convivência, jogos e transmissão de partidas quando licenciada. Priorizar unidade Express piloto antes de expandir. Dimensionar equipe por demanda, jornada e legislação.\n\n3. INVESTIMENTO HIPOTÉTICO POR UNIDADE (R$)\nItem                                Express       Família\nTaxa inicial proposta                 15.000        20.000\nEquipamentos                          25.000        45.000\nObra e instalações                    12.000        35.000\nPré-abertura e treinamento             5.000        10.000\nEstoque inicial                        5.000         8.000\nCapital de giro                        13.000        27.000\nTOTAL REFERENCIAL                     75.000       145.000\nObter ao menos três cotações, incluir caução, licenças, frete, adequações, seguros e contingência quando não contemplados; recalcular capital de giro para 3–6 meses de operação conforme fluxo de caixa. Não ofertar esses valores até validação. Taxas são propostas, não preços aprovados.\n\n4. ECONOMIA UNITÁRIA — EXEMPLO MENSAL EXPRESS\nPremissas: CMV 32%, embalagens 4%, meios de pagamento/canais 5%, tributos 7%, royalties 5%, fundo de marketing 2% da receita bruta; total variável 55%. Custos fixos estimados R$ 15.000 (pessoal/encargos, aluguel, utilidades, manutenção, pró-labore e despesas administrativas). Margem de contribuição 45%.\nCenário             Receita           Resultado operacional estimado\nConservador         R$ 30.000          -R$ 1.500\nBase                R$ 40.000           R$ 3.000\nOtimista            R$ 55.000           R$ 9.750\nPonto de equilíbrio aproximado R$ 33.333/mês. Com tíquete hipotético de R$ 50 e 26 dias abertos, cerca de 26 pedidos/dia para equilíbrio. Formato Família: fixos hipotéticos R$ 25.000, mesma margem de contribuição, equilíbrio R$ 55.556/mês; a R$ 70.000/mês, resultado operacional R$ 6.500. Resultados não são lucro líquido, fluxo de caixa ou garantia de payback; excluem financiamento, depreciação, investimentos adicionais e ajustes tributários. Confirmar com contador e DRE real de 12–24 meses; testar sensibilidade a CMV, vendas, comissões e pessoal.\n\n5. RECEITA E OBRIGAÇÕES DA FRANQUEADORA\nTaxa inicial para seleção, implantação, treinamento e transferência de know-how. Royalties propostos 5% sobre faturamento bruto, com base contratual clara, remunerando suporte e gestão; fundo de marketing proposto 2%, prestação de contas separada e uso em benefício da rede. XTL Food, XTL Ads e XTL Growth: serviços opcionais ou obrigatórios somente conforme contrato e COF, com custos, responsabilidades, tratamento de dados, titularidade e níveis de serviço transparentes. Sem dupla cobrança pelo mesmo serviço. Medir custos reais do suporte antes de aprovar taxas. Ex.: 5 Express com receita de R$ 40 mil cada gerariam R$ 10 mil/mês de royalties brutos e R$ 4 mil/mês de fundo vinculado, antes dos custos da franqueadora.\n\n6. PADRONIZAÇÃO E SUPORTE\nManuais de implantação, layout, equipamentos, compras homologadas, fichas técnicas com gramagem e CMV, armazenamento, validade, rastreabilidade, alergênicos, limpeza e segurança alimentar, treinamento, atendimento, embalagem, entrega, caixa, manutenção, auditoria e incidentes. Treinamento inicial teórico/prático e acompanhamento de abertura a validar. Cardápio núcleo obrigatório e variações locais aprovadas. Definir fornecedores alternativos, controle de qualidade, fichas de estoque e critérios de descarte. Implantar painel XTL Food por unidade com isolamento de dados e perfis; XTL Growth para lançamento e campanhas, XTL Ads para distribuição conforme contrato.\n\n7. SELEÇÃO DE CANDIDATOS E TERRITÓRIO\nPerfil: operador com dedicação, capital comprovável, afinidade com alimentação e capacidade de gerir pessoas. Funil: manifestação de interesse → entrevista → avaliação financeira e de praça → visita à unidade matriz → análise de viabilidade → COF e prazo legal → contrato → implantação. Começar com um piloto na região (Araricá, Igrejinha ou Sapiranga, hipóteses não aprovadas); selecionar praça por demanda, concorrência, aluguel, capacidade de entrega e logística. Definir exclusividade, preferência, canais digitais e conflitos de território no contrato, sem reservar áreas antes da aprovação.\n\n8. JURÍDICO, SANITÁRIO E DADOS\nIdentificar titular da marca e verificar situação no INPI; formalizar titularidade/licenças, CNPJ franqueador, contabilidade, contratos de fornecedores, manual e contrato de franquia. Lei 13.966/2019: elaborar COF com todos os elementos legais (incluindo balanços dos dois últimos exercícios, investimento, taxas, território, suporte, situação da marca e minuta contratual); fornecer ao menos dez dias antes de assinatura de contrato/pré-contrato ou pagamento de taxa. Não cobrar nem vender antes da validação jurídica. Licenciamento municipal, vigilância sanitária, bombeiros, boas práticas de alimentação, trabalhista, tributário, publicidade e LGPD. Validar com profissionais habilitados. Fontes: https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/l13966.htm ; https://portfolio-sebraetec.sebrae.com.br/fichas/14031-5--formatacao-de-franquia\n\n9. ROADMAP E PORTÕES DE DECISÃO\nFase 0 (0–30 dias): levantar DRE, mix, pedidos, capacidade, titularidade da marca, custos, contratos e demanda; decisão da família sobre o projeto.\nFase 1 (30–60): documentar e testar receitas/processos, cotar implantação, projetar caixa e validar economia unitária; aprovar manuais e plano de suporte.\nFase 2 (60–90): estruturar COF e contrato com assessoria, selecionar praça e operador piloto, fazer auditoria de prontidão. Não contratar antes dos portões legais.\nFase 3 (90–180+): implantar uma unidade piloto após aprovações, medir qualidade e resultado por pelo menos 3–6 meses; só ampliar se desempenho e suporte forem sustentáveis.\nIndicadores: CMV, tíquete, pedidos/dia, margem de contribuição, resultado, caixa, tempo de preparo/entrega, reclamações, avaliações, desperdício, conformidade sanitária e satisfação dos franqueados. Limites e metas definidos a partir da matriz, não presumidos.\nRiscos: insuficiência de caixa, perda de padrão, dependência de fundador, marca não regularizada, baixa demanda, conflitos territoriais, custos de plataformas e vazamento de dados. Mitigar com piloto, auditoria, contingências, contratos e controles de acesso.\n\n10. PENDÊNCIAS PARA APROVAÇÃO\nDRE real e dados operacionais; investimento cotado; titularidade da marca; autorização dos sócios; manuais; modelo de suporte e tecnologia; orçamento da franqueadora; COF/contrato; política territorial; plano sanitário. Nenhum valor ou formato aprovado. Status: estudo interno, bloqueado para comercialização."});
   }
   if(act==='session')return respond(res,200,{actor});
   return respond(res,404,{error:'Recurso não encontrado.'});
  }
  const result=await action(req,actor,payload(req));
  return respond(res,200,{ok:true,...result});
 }catch(err){
  const code=err?.isValidation?400:(Number.isInteger(err.status)?err.status:503);
  if(code===503)console.warn(JSON.stringify({event:'backoffice_unavailable',route:req.method||'GET'}));
  return respond(res,code,{error:code===503?
   'Operação indisponível. Nenhuma alteração foi confirmada.':err.message});
 }
};
