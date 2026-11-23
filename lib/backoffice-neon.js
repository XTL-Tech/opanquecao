'use strict';
// HTTP Neon driver: uma requisição por query; SEM pool TCP persistente
// e sem cron/polling que impeça o scale-to-zero do plano Free.
const core=require('./backoffice-core');
const crypto=require('node:crypto');
class StoreError extends Error {
 constructor(message,status=503){super(message);this.status=status;}
}
const configured=()=>process.env.BACKOFFICE_ENABLED==='true' &&
 process.env.BACKOFFICE_PROVIDER==='neon' &&
 /^postgres(ql)?:\/\/[^ ]+@[^ ]+/.test(process.env.DATABASE_URL||'');
let sql;
function query(){
 if(!configured())throw new StoreError('Backoffice Neon indisponível ou não ativado.');
 if(!sql){
  const {neon}=require('@neondatabase/serverless');
  sql=neon(process.env.DATABASE_URL,{fullResults:false});
 }
 return sql;
}
async function run(statement,params=[]){
 try{return await query().query(statement,params);}
 catch(e){
  const code=String(e?.code||'');
  if(['23505','23514','40001','40P01'].includes(code))
   throw new StoreError('Conflito de dados. Atualize o painel e reconcilie antes de tentar novamente.',409);
  throw new StoreError('Banco temporariamente indisponível. Alteração não confirmada.');
 }
}
const columns='o.request_id,o.ref_code,o.customer_id,o.origin,o.status,o.telegram_state,o.items,o.fulfillment,o.note,o.subtotal_cents,o.delivery_fee_cents,o.payment_method,o.payment_status,o.settled_business_date,o.created_at,o.updated_at';
async function staff(userId){
 const result=await run('SELECT user_id,role,active FROM dp.staff WHERE user_id=$1 AND active=true LIMIT 1',[userId]);
 return result[0]||null;
}
async function findCustomer(phone){
 return (await run('SELECT id,name,phone,notes FROM dp.customers WHERE phone=$1 LIMIT 1',[phone]))[0]||null;
}
async function upsertCustomer({name,phone}){
 const r=await run('INSERT INTO dp.customers(name,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET phone=excluded.phone RETURNING id,name,phone,notes',[name,phone]);
 return r[0];
}
async function updateCustomer(id,patch){
 const name=core.name(patch.name),phone=core.phone(patch.phone),notes=core.note(patch.notes);
 const rows=await run('UPDATE dp.customers SET name=$1,phone=$2,notes=$3,updated_at=now() WHERE id=$4 RETURNING id,name,phone,notes,created_at,updated_at',[name,phone,notes,id]);
 if(!rows.length)throw new StoreError('Cliente não encontrado.',404);
 return rows[0];
}
async function getOrder(id){
 return (await run('SELECT '+columns+' FROM dp.orders o WHERE o.request_id=$1 LIMIT 1',[id]))[0]||null;
}
async function createOrder({requestId,customer,items,fulfillment,note,origin='site',status='pending_customer',telegramState='pending'}){
 if(!core.UUID.test(requestId))core.fail('Identificador inválido.');
 const subtotal=items.reduce((n,l)=>n+l.cents*l.quantity,0);
 const hash=core.digest({customer:{id:customer.id},items,fulfillment,note,origin});
 const record=await run(
  'INSERT INTO dp.orders(request_id,ref_code,customer_id,origin,status,telegram_state,items,fulfillment,note,subtotal_cents,payload_sha256) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11) ON CONFLICT(request_id) DO NOTHING RETURNING request_id,telegram_state',
  [requestId,requestId.slice(0,8).toUpperCase(),customer.id,origin,status,telegramState,JSON.stringify(items),JSON.stringify(fulfillment),note,subtotal,hash]
 );
 if(record.length)return{created:true,record:record[0]};
 const matched=(await run('SELECT request_id,telegram_state,payload_sha256 FROM dp.orders WHERE request_id=$1 LIMIT 1',[requestId]))[0];
 if(!matched)throw new StoreError('Registro concorrente pendente de confirmação.',409);
 if(matched.payload_sha256!==hash)throw new StoreError('Identificador reutilizado para pedido diferente.',409);
 return{created:false,record:matched};
}
async function patchOrder(id,where,patch){
 const allow=['status','telegram_state','delivery_fee_cents','payment_status','payment_method','paid_at','accepted_at','delivered_at','updated_by'];
 const keys=Object.keys(patch);
 if(!keys.length||keys.some(x=>!allow.includes(x)))core.fail('Alteração inválida.');
 const vals=keys.map(k=>patch[k]),sets=keys.map((k,i)=>k+'=$'+(i+1));
 const whereParts=['request_id=$'+(vals.length+1)];vals.push(id);
 for(const [key,val] of Object.entries(where||{})){
  if(!['status','payment_status','telegram_state','delivery_fee_cents'].includes(key))core.fail('Filtro inválido.');
  if(val==='is.null'){whereParts.push(key+' IS NULL');continue;}
  if(typeof val!=='string'||!val.startsWith('eq.'))core.fail('Filtro inválido.');
  vals.push(val.slice(3));whereParts.push(key+'=$'+vals.length);
 }
 const rows=await run('UPDATE dp.orders SET '+sets.join(',')+',updated_at=now() WHERE '+whereParts.join(' AND ')+' RETURNING *',vals);
 if(rows.length!==1)throw new StoreError('Pedido alterado em outra sessão. Atualize antes de continuar.',409);
 return rows[0];
}
async function dashboard(){
 const day=core.businessDate();
 // Não baixa milhares de clientes e pedidos por tela. Uma página pequena,
 // agregado calculado no banco e catálogo carregado SOMENTE no editor.
 const [orders,customers,closings,cash,queue]=await Promise.all([
  run('SELECT '+columns+',c.name AS customer_name,c.phone AS customer_phone FROM dp.orders o JOIN dp.customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 80'),
  run('SELECT id,name,phone,notes,created_at,updated_at FROM dp.customers ORDER BY created_at DESC LIMIT 100'),
  run('SELECT business_date,summary,counted_cash_cents,discrepancy_cents,notes,closed_at FROM dp.cash_closings ORDER BY business_date DESC LIMIT 14'),
  run('SELECT count(*)::int AS orders,coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)),0)::int AS total_cents,'+
   'coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method=$2),0)::int AS cash_cents,'+
   'coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method=$3),0)::int AS pix_cents,'+
   'coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method=$4),0)::int AS credit_cents,'+
   'coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method=$5),0)::int AS debit_cents,'+
   'coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method=$6),0)::int AS other_cents '+
   'FROM dp.orders WHERE settled_business_date=$1 AND status=$7 AND payment_status=$8',
   [day,'cash','pix','credit','debit','other','delivered','paid']),
  run("SELECT status,count(*)::integer AS total FROM dp.orders WHERE status IN ('pending_customer','awaiting_acceptance','accepted','completed') GROUP BY status")
 ]);
 return{today:day,orders,customers,closings, cash:cash[0],catalog:null,
  queueCounts:Object.fromEntries(queue.map(row=>[row.status,row.total]))};
}
async function getCatalog(){
 const x=(await run('SELECT data,revision,updated_at FROM dp.catalog WHERE id=$1 LIMIT 1',['opanquecao']))[0];
 if(!x)throw new StoreError('Catálogo ainda não foi importado.');
 return{catalog:x.data,revision:x.revision,updated_at:x.updated_at};
}
async function changePrice({category,product,variant,priceCents,revision,actorId}){
 if(process.env.CATALOG_SOURCE!=='neon')throw new StoreError('O catálogo público ainda não está vinculado ao Neon.',409);
 const current=await getCatalog();
 if(!Number.isInteger(revision)||revision!==current.revision)throw new StoreError('Catálogo alterado em outra sessão.',409);
 const cat=current.catalog.categorias.find(x=>x.id===category),item=cat?.itens.find(x=>x.nome===product);
 const old=variant==='preco'?item?.preco:variant.startsWith('size:')?item?.tamanhos?.[variant.slice(5)]:
  item?.tamanhos_acai?.find(x=>x.tamanho===variant.slice(5))?.preco;
 const next=core.applyPrice(current.catalog,{category,product,variant,priceCents});
 const rows=await run(
  'WITH upd AS (UPDATE dp.catalog SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING data,revision,updated_at),'+
  ' hist AS (INSERT INTO dp.price_changes(category,product,variant,old_price,new_price,actor_id) SELECT $4,$5,$6,$7,$8,$9 FROM upd RETURNING id)'+
  ' SELECT upd.data,upd.revision,upd.updated_at FROM upd JOIN hist ON TRUE',
  [JSON.stringify(next),'opanquecao',revision,category,product,variant,old||null,core.formatPrice(priceCents),actorId]
 );
 if(rows.length!==1)throw new StoreError('Preço alterado por outro usuário. Recarregue.',409);
 return{catalog:rows[0].data,revision:rows[0].revision,updated_at:rows[0].updated_at};
}
async function closing({today,counted,notes,userId}){
 const r=await run('SELECT dp.close_cash($1::date,$2::integer,$3::text,$4::text) AS summary',[today,counted,notes,userId]);
 return{business_date:today,summary:r[0].summary,counted_cash_cents:counted,
  discrepancy_cents:counted-Number(r[0].summary.cash_cents),closed_at:new Date().toISOString()};
}
async function events(id){
 return run('SELECT id AS event_id,actor_id,changed_at, jsonb_build_object($2,previous_status,$3,previous_payment) AS old_values,'+
  'jsonb_build_object($2,next_status,$3,next_payment) AS new_values FROM dp.order_events WHERE request_id=$1 ORDER BY changed_at DESC LIMIT 30',
  [id,'status','payment_status']);
}
async function searchOrders({term='',status='',before=null,beforeId=null}={}){
 const needle=core.tidy(term,65).toLowerCase().replace(/[%_\\]/g,'');
 const normalized=status&&core.ORDER_STATES.includes(status)?status:'';
 const cursor=before&&beforeId&&core.UUID.test(beforeId)&&!Number.isNaN(Date.parse(before))?
  new Date(before).toISOString():null;
 return run(
  'SELECT '+columns+',c.name AS customer_name,c.phone AS customer_phone FROM dp.orders o '+
  'JOIN dp.customers c ON c.id=o.customer_id WHERE '+
  "($1='' OR lower(c.name) LIKE $1||'%' OR c.phone LIKE $2||'%' OR o.ref_code LIKE $3||'%') "+
  "AND ($4='' OR o.status=$4) "+
  'AND ($5::timestamptz IS NULL OR (o.created_at,o.request_id)<($5::timestamptz,$6::uuid)) '+
  'ORDER BY o.created_at DESC,o.request_id DESC LIMIT 51',
  [needle,needle.replace(/\D/g,''),needle.toUpperCase().replace(/^#/,''),
   normalized,cursor,cursor?beforeId:null]
 );
}
async function searchCustomers(term,cursor){
 const needle=core.tidy(term||'',70).toLowerCase(),offset=Math.max(0,Math.min(10000,Number(cursor)||0));
 return run('SELECT id,name,phone,notes,created_at,updated_at FROM dp.customers WHERE lower(name) LIKE $1 OR phone LIKE $2 ORDER BY created_at DESC LIMIT 51 OFFSET $3',
  [needle+'%',needle.replace(/\D/g,'')+'%',offset]);
}
async function sandboxRecent(actorId){
 const rows=await run(
  'SELECT id,provider_checkout_id,external_ref,status,amount_cents,created_at,changed_at FROM dp.asaas_sandbox '+
  'WHERE created_by=$1 ORDER BY created_at DESC LIMIT 10',[actorId]);
 return rows;
}
async function sandboxClaim(actorId){
 const old=await run("SELECT id,provider_checkout_id,status,created_at FROM dp.asaas_sandbox WHERE created_by=$1 AND created_at > now()-interval '10 minutes' ORDER BY created_at DESC LIMIT 1",[actorId]);
 if(old.length){
  if(old[0].provider_checkout_id)return{created:false,record:old[0]};
  throw new StoreError('Já existe um checkout de teste em criação. Aguarde ou concilie com a conta Asaas.',409);
 }
 const [row]=await run(
  'INSERT INTO dp.asaas_sandbox(external_ref,amount_cents,created_by) VALUES($1,$2,$3) '+
  'RETURNING id,external_ref,amount_cents,status',
  ['dp-sandbox-'+crypto.randomUUID(),500,actorId]);
 return{created:true,record:row};
}
async function sandboxAttach(id,providerId){
 const rows=await run("UPDATE dp.asaas_sandbox SET provider_checkout_id=$2,status='active',changed_at=now() WHERE id=$1 AND status='creating' RETURNING id,provider_checkout_id,status",[id,providerId]);
 if(rows.length!==1)throw new StoreError('Checkout criado mas vinculação local incerta. Reconciliar antes de repetir.',503);
 return rows[0];
}
async function sandboxMarkUncertain(id){
 await run("UPDATE dp.asaas_sandbox SET status='uncertain',changed_at=now() WHERE id=$1 AND status='creating'",[id]);
}
async function sandboxEvent({id,checkout,event,externalReference}){
 // O evento é aceito uma vez só e apenas se pertence ao checkout salvo.
 // A transição é transacional no PostgreSQL, sem callbacks otimistas.
 const rows=await run(
  'WITH target AS (SELECT id FROM dp.asaas_sandbox WHERE provider_checkout_id=$2 AND ($4=\'\' OR external_ref=$4)),'+
  ' accepted AS (INSERT INTO dp.asaas_events(event_id,provider_checkout_id,event_type) '+
  ' SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM target) ON CONFLICT(event_id) DO NOTHING RETURNING event_id),'+
  ' updated AS (UPDATE dp.asaas_sandbox SET status=CASE $3 '+
  " WHEN 'CHECKOUT_PAID' THEN 'paid' WHEN 'CHECKOUT_EXPIRED' THEN 'expired' "+
  " WHEN 'CHECKOUT_CANCELED' THEN 'canceled' WHEN 'CHECKOUT_CREATED' THEN 'active' ELSE status END, "+
  ' changed_at=now() WHERE id IN(SELECT id FROM target) AND EXISTS(SELECT 1 FROM accepted) '+
  " AND status<>'paid' RETURNING id) "+
  ' SELECT (SELECT count(*)::integer FROM target) AS matched,'+
  ' (SELECT count(*)::integer FROM accepted) AS inserted,'+
  ' (SELECT count(*)::integer FROM updated) AS updated',
  [id,checkout,event,externalReference]
 );
 return rows[0];
}
module.exports={StoreError,configured,run,staff,findCustomer,upsertCustomer,updateCustomer,
 getOrder,createOrder,patchOrder,dashboard,getCatalog,changePrice,closing,events,searchCustomers,searchOrders,sandboxRecent,sandboxClaim,sandboxAttach,sandboxMarkUncertain,sandboxEvent};
