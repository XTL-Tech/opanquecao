'use strict';
// XTL / Disk Panquecão: todas as operações com PII acontecem no servidor.
const {randomUUID}=require('node:crypto');
const c=require('../lib/backoffice-core');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const areas=require('../delivery-areas.json');
const operations=require('../lib/operational-orders');
const afterSales=require('../lib/after-sales');
const reports=require('../lib/management-reports');
const liveBI=require('../lib/live-bi');
const comandas=require('../lib/comandas');
const annual=require('../lib/annual-ranking-fiscal');
const ads=require('../lib/ad-contracts');
const storeOperations=require('../lib/store-operations');
const lite=require('../lib/lite-admin');

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
  const tab=body.comandaId?await comandas.context(actor,body.comandaId):null;
  const customer=tab?{id:tab.customer_id,name:tab.name,phone:tab.phone}:await db.upsertCustomer({name:c.name(body.name),phone:c.phone(body.phone)});
  const {normalizeFulfillment,standardDeliveryFee}=await import('../fulfillment.mjs');
  const fulfillment=normalizeFulfillment(tab?{type:'table',table:String(tab.table_number)}:body.fulfillment,areas);
  const deliveryFeeCents=fulfillment.type==='delivery'&&body.fulfillment?.neighborhood!=='__other__'?standardDeliveryFee(fulfillment.city,fulfillment.neighborhood,areas):null;
  const catalog=(await db.getCatalog()).catalog;
  if(!catalog)throw new db.StoreError('Catálogo indisponível.');
  const {priceOrder}=await import('../order-catalog.mjs');
  const items=priceOrder(catalog,body.lines);
  const result=await db.createOrder({
   requestId:randomUUID(),customer,items,fulfillment,
   note:c.note(body.note,400),origin:'manual',status:'awaiting_acceptance',
   telegramState:'not_applicable',comandaId:tab?.id,deliveryFeeCents
  });
  return {order:result.record};
 }
 if(a==='order_status'){
  const id=requireId(body.id),order=await db.getOrder(id);
  if(!order)throw new db.StoreError('Pedido não encontrado.',404);
  if(order.fulfillment?.type==='delivery'&&body.next==='delivered'&&order.status!=='out_for_delivery')c.fail('Registre a saída com o motoboy antes de entregar.');
  if(body.next==='out_for_delivery'&&!lite.enabled())c.fail('A saída deve ser registrada pela conta do motoboy.');
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
  if(!['accepted','preparing','completed','out_for_delivery','delivered'].includes(order.status)||order.payment_status!=='pending')
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
  if(!['admin','manager'].includes(actor.role))throw new auth.AuthError('Somente a gestão pode alterar preços.',403);
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
  if(method==='GET'&&act==='ad_playlist'){
   if(!db.configured())return respond(res,503,{error:'Programação indisponível.'});
   return respond(res,200,await ads.playlist());
  }
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
  if(lite.enabled()){
   if(!lite.allowedRole(actor.role)||!lite.allowedAction(method,act))throw new auth.AuthError('Acesso restrito à administração.',403);
   if(method==='GET'&&act==='delivery_map')return respond(res,200,{points:await lite.deliveryMap()});
   if(method==='GET'&&act==='account_history')return respond(res,200,{orders:await lite.history(req.query?.subject)});
   if(method==='POST'&&act==='account_search')return respond(res,200,{accounts:await lite.accounts(payload(req).term)});
  }
  if(operations.restricted(actor.role)){
   if(method==='GET'&&act==='session')return respond(res,200,{actor});
   if(method==='GET'&&act==='dashboard')return respond(res,200,await operations.queue(actor));
   if(method==='POST'&&act==='order_status')return respond(res,200,{ok:true,...await operations.transition(actor,payload(req))});
   throw new auth.AuthError('Acesso não autorizado para este perfil.',403);
  }
  if(method==='GET'){
   if(act==='operational_queue'){
    if(actor.role!=='admin')throw new auth.AuthError('Somente o superadministrador.',403);
    return respond(res,200,await operations.queue(actor,req.query?.view));
   }
   if(act==='store_operations')return respond(res,200,await storeOperations.get(actor));
   if(act==='ad_contracts')return respond(res,200,await ads.list(actor));
   if(act==='annual_ranking')return respond(res,200,await annual.ranking(actor,req.query));
   if(act==='fiscal_refunds')return respond(res,200,await annual.queues(actor));
   if(act==='comandas')return respond(res,200,await comandas.list(actor));
   if(act==='live_bi')return respond(res,200,await liveBI.live(actor));
   if(act==='management_reports')return respond(res,200,await reports.report(actor,req.query));
   if(act==='after_sales')return respond(res,200,await afterSales.queue(actor));
   if(act==='dashboard')return respond(res,200,{actor,lite:lite.enabled(),...await db.dashboard()});
   if(act==='catalog')return respond(res,200,{catalog:await db.getCatalog()});
   if(act==='customers')return respond(res,200,{customers:await db.searchCustomers(req.query?.term,req.query?.cursor||0)});
   if(act==='orders')return respond(res,200,{orders:await db.searchOrders({term:req.query?.term,status:req.query?.status,before:req.query?.before,beforeId:req.query?.beforeId})});
   if(act==='events')return respond(res,200,{events:await db.events(requireId(req.query?.id))});
   if(act==='session')return respond(res,200,{actor});
   return respond(res,404,{error:'Recurso não encontrado.'});
  }
  if(act==='operational_status'){
   if(actor.role!=='admin')throw new auth.AuthError('Somente o superadministrador.',403);
   const body=payload(req);return respond(res,200,{ok:true,...await operations.transition(actor,body,body.view)});
  }
  if(act==='store_operations_save')return respond(res,200,{ok:true,...await storeOperations.save(actor,payload(req))});
  if(act==='ad_contract_save')return respond(res,200,{ok:true,...await ads.save(actor,payload(req))});
  if(act==='ranking_enroll')return respond(res,200,await annual.enroll(actor,payload(req)));
  if(act==='ranking_withdraw')return respond(res,200,await annual.withdraw(actor,payload(req)));
  if(act==='fiscal_request')return respond(res,200,await annual.fiscalRequest(actor,payload(req)));
  if(act==='pix_refund_request')return respond(res,200,await annual.refundRequest(actor,payload(req)));
  if(act==='comanda_open')return respond(res,200,{ok:true,...await comandas.open(actor,payload(req))});
  if(act==='comanda_customer')return respond(res,200,await comandas.lookupCustomer(actor,payload(req)));
  if(act==='comanda_find')return respond(res,200,{ok:true,...await comandas.find(actor,payload(req))});
  if(act==='comanda_close')return respond(res,200,{ok:true,...await comandas.close(actor,payload(req))});
  if(act==='after_sale_status')return respond(res,200,{ok:true,...await afterSales.change(actor,payload(req))});
  const result=await action(req,actor,payload(req));
  return respond(res,200,{ok:true,...result});
 }catch(err){
  const code=err?.isValidation?400:(Number.isInteger(err.status)?err.status:503);
  if(code===503)console.warn(JSON.stringify({event:'backoffice_unavailable',route:req.method||'GET'}));
  return respond(res,code,{error:code===503?
   'Operação indisponível. Nenhuma alteração foi confirmada.':err.message});
 }
};
