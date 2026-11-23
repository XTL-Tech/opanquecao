'use strict';
const c=require('./backoffice-core');
class StoreError extends Error {constructor(message,status=503){super(message);this.status=status;}}
function configured(){return process.env.BACKOFFICE_ENABLED==='true';}
function config(){
 const url=process.env.SUPABASE_URL;
 const pub=process.env.SUPABASE_PUBLISHABLE_KEY;
 const secret=process.env.SUPABASE_SECRET_KEY;
 if(!configured()||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url||'')||!pub||!secret)
  throw new StoreError('O backoffice ainda não foi ativado no banco exclusivo do restaurante.');
 return {url,publicKey:pub,secret};
}
function params(object={}){
 const p=new URLSearchParams();
 for(const [key,value] of Object.entries(object))if(value!==null&&value!==undefined)p.set(key,String(value));
 return '?'+p;
}
async function query(table,{method='GET',filter={},body,prefer,timeout=8500}={}){
 const {url,secret}=config();
 const q=params(filter);
 let response;
 try{
  response=await fetch(url+'/rest/v1/'+table+q,{
   method,cache:'no-store',
   headers:{apikey:secret,Accept:'application/json',
    ...(body?{'Content-Type':'application/json'}:{}),
    ...(prefer?{Prefer:prefer}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),
   signal:AbortSignal.timeout(timeout)
  });
 }catch{throw new StoreError('Banco indisponível. Nenhuma alteração foi confirmada.');}
 if(!response.ok){
  if(response.status===409||response.status===400||response.status===422)
   throw new StoreError('Conflito de dados ou caixa fechado. Atualize a tela antes de continuar.',409);
  throw new StoreError('Não foi possível concluir a operação no banco.');
 }
 const raw=await response.text();
 try{return raw?JSON.parse(raw):null;}catch{throw new StoreError('Resposta inválida do banco.');}
}
const scope={restaurant_id:'eq.'+c.RESTAURANT};
function list(table,filter,select,limit=300){
 return query(table,{filter:{...scope,...filter,select,order:table==='restaurant_cash_closings'?'business_date.desc':'created_at.desc',limit}});
}
async function findCustomer(phone){
 const r=await query('restaurant_customers',{filter:{...scope,phone:'eq.'+phone,select:'id,name,phone,notes',limit:1}});
 return r[0]||null;
}
async function upsertCustomer({name,phone}){
 const existing=await findCustomer(phone);
 if(existing)return existing;
 const created=await query('restaurant_customers',{
  method:'POST',filter:{on_conflict:'restaurant_id,phone'},
  body:{restaurant_id:c.RESTAURANT,name,phone},
  prefer:'resolution=ignore-duplicates,return=representation'
 });
 if(created?.[0])return created[0];
 const raced=await findCustomer(phone);
 if(!raced)throw new StoreError('Cadastro do cliente não confirmado.');
 return raced;
}
async function getOrder(id){
 const orders=await query('restaurant_orders',{filter:{
  ...scope,request_id:'eq.'+id,select:'*',limit:1
 }});
 return orders[0]||null;
}
async function createOrder({requestId,customer,items,fulfillment,note,origin='site',status='pending_customer',telegramState='pending'}){
 if(!c.UUID.test(requestId))c.fail('Código do pedido inválido.');
 const sub=items.reduce((v,x)=>v+x.cents*x.quantity,0);
 const digest=c.digest({customer,items,fulfillment,note,origin});
 const record={
  restaurant_id:c.RESTAURANT,request_id:requestId,ref_code:requestId.slice(0,8).toUpperCase(),
  customer_id:customer.id,items,fulfillment,note,subtotal_cents:sub,
  origin,status,telegram_state:telegramState,payload_sha256:digest
 };
 const inserted=await query('restaurant_orders',{method:'POST',filter:{
  on_conflict:'restaurant_id,request_id'},body:record,
  prefer:'resolution=ignore-duplicates,return=representation'
 });
 if(inserted?.[0])return {record:inserted[0],created:true};
 const existing=await getOrder(requestId);
 if(existing?.payload_sha256!==digest)throw new StoreError('Código reutilizado com dados diferentes.',409);
 return {record:existing,created:false};
}
async function patchOrder(id,where,body){
 const results=await query('restaurant_orders',{method:'PATCH',filter:{
  ...scope,request_id:'eq.'+id,...where,select:'*'
 },body,prefer:'return=representation'});
 if(results?.length!==1)throw new StoreError('O pedido foi alterado em outra sessão. Atualize a tela.',409);
 return results[0];
}
async function dashboard(){
 const today=c.businessDate();
 const [orders,customers,closings,catalogRows,cashRows]=await Promise.all([
  list('restaurant_orders',{},'request_id,ref_code,customer_id,origin,status,telegram_state,items,fulfillment,note,subtotal_cents,delivery_fee_cents,payment_method,payment_status,settled_business_date,created_at,updated_at',250),
  list('restaurant_customers',{},'id,name,phone,notes,created_at,updated_at',400),
  list('restaurant_cash_closings',{},'business_date,summary,counted_cash_cents,discrepancy_cents,notes,closed_at',32),
  query('restaurant_catalogs',{filter:{...scope,select:'catalog,revision,updated_at',limit:1}}),
  query('restaurant_orders',{filter:{...scope,settled_business_date:'eq.'+today,
   select:'request_id,status,payment_status,payment_method,subtotal_cents,delivery_fee_cents,fulfillment,settled_business_date',limit:1000}})
 ]);
 return {today,orders,customers,closings,catalog:catalogRows?.[0]||null,
   cash:c.tally(cashRows||[],today)};
}
async function updateCustomer(id,body){
 const customer=await query('restaurant_customers',{method:'PATCH',filter:{
   ...scope,id:'eq.'+id,select:'id,name,phone,notes,created_at,updated_at'
 },body:{...body,updated_at:new Date().toISOString()},prefer:'return=representation'});
 if(customer?.length!==1)throw new StoreError('Cliente não encontrado.',404);
 return customer[0];
}
async function closing({today,counted,notes,userId}){
 const row=await query('restaurant_cash_closings',{
  method:'POST',body:{
   restaurant_id:c.RESTAURANT,business_date:today,
   counted_cash_cents:counted,notes,closed_by:userId},
  prefer:'return=representation'
 });
 if(row?.length!==1)throw new StoreError('Fechamento não confirmado.',503);
 return row[0];
}
async function changePrice({category,product,variant,priceCents,revision}){
 if(process.env.CATALOG_SOURCE!=='supabase')
  throw new StoreError('Edição suspensa: o site ainda utiliza o cardápio versionado em arquivo.',409);
 const rows=await query('restaurant_catalogs',{filter:{...scope,select:'catalog,revision',limit:1}});
 if(rows?.length!==1)throw new StoreError('Catálogo não encontrado.');
 const current=rows[0];
 if(!Number.isSafeInteger(revision)||revision!==current.revision)throw new StoreError('O cardápio mudou. Atualize e tente novamente.',409);
 const next=c.applyPrice(current.catalog,{category,product,variant,priceCents});
 const updated=await query('restaurant_catalogs',{method:'PATCH',filter:{
  ...scope,revision:'eq.'+revision,select:'catalog,revision,updated_at'
 },body:{catalog:next},prefer:'return=representation'});
 if(updated?.length!==1)throw new StoreError('O preço foi alterado por outro atendente. Atualize.',409);
 return updated[0];
}
async function events(id){
 return query('restaurant_order_events',{filter:{
  ...scope,request_id:'eq.'+id,select:'event_id,actor_id,old_values,new_values,changed_at',order:'changed_at.desc',limit:30}});
}
module.exports={StoreError,configured,config,query,scope,list,findCustomer,upsertCustomer,getOrder,createOrder,patchOrder,dashboard,updateCustomer,closing,changePrice,events};
