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
  const actor=await auth.actor(req);
  if(method==='GET'){
   if(act==='dashboard')return respond(res,200,{actor,...await db.dashboard()});
   if(act==='catalog')return respond(res,200,{catalog:await db.getCatalog()});
   if(act==='customers')return respond(res,200,{customers:await db.searchCustomers(req.query?.term,req.query?.cursor||0)});
   if(act==='orders')return respond(res,200,{orders:await db.searchOrders({term:req.query?.term,status:req.query?.status,before:req.query?.before,beforeId:req.query?.beforeId})});
   if(act==='events')return respond(res,200,{events:await db.events(requireId(req.query?.id))});
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
