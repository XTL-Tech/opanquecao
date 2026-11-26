'use strict';
const db=require('./backoffice-neon');
const c=require('./backoffice-core');
const {AuthError}=require('./backoffice-neon-auth');
const restricted=role=>['kitchen','courier'].includes(role);
const cleanItems=items=>(Array.isArray(items)?items:[]).map(i=>({
 product:i.product,category:i.category,quantity:i.quantity,option:i.option,
 flavors:i.flavors,freeExtras:i.freeExtras,paidExtras:i.paidExtras,note:i.note
}));
async function queue(actor,view){
 const role=actor.role==='admin'?view:actor.role;
 if(!restricted(role))throw new AuthError('Perfil operacional inválido.',403);
 const kitchen=role==='kitchen';
 // Cozinha nunca consulta cadastro do cliente, endereço, telefone nem valores.
 const rows=kitchen?await db.run(
  "SELECT request_id,ref_code,status,items,note,fulfillment->>'type' AS mode,fulfillment->>'table' AS table_name,created_at FROM dp.orders WHERE status IN ('accepted','preparing') ORDER BY created_at LIMIT 80"):
  await db.run("SELECT o.request_id,o.ref_code,o.status,o.fulfillment,o.created_at,c.name AS customer_name,c.phone AS customer_phone FROM dp.orders o JOIN dp.customers c ON c.id=o.customer_id WHERE o.fulfillment->>'type'='delivery' AND ((o.status='completed' AND o.courier_id IS NULL) OR (o.status='out_for_delivery' AND (o.courier_id=$1 OR $2::boolean))) ORDER BY o.created_at LIMIT 80",[actor.id,actor.role==='admin']);
 return {actor,operational:true,today:c.businessDate(),orders:rows.map(o=>kitchen?{
  request_id:o.request_id,ref_code:o.ref_code,status:o.status,items:cleanItems(o.items),note:o.note,mode:o.mode,table_name:o.table_name,created_at:o.created_at
 }:{
  request_id:o.request_id,ref_code:o.ref_code,status:o.status,created_at:o.created_at,
  customer_name:o.customer_name,customer_phone:o.customer_phone,
  fulfillment:Object.fromEntries(['city','neighborhood','street','number','complement','reference','postalCode','location'].filter(k=>o.fulfillment?.[k]!=null).map(k=>[k,o.fulfillment[k]]))
 })};
}
async function transition(actor,body,view){
 const role=actor.role==='admin'?view:actor.role;
 const id=body.id,next=body.next;
 if(typeof id!=='string'||!c.UUID.test(id))c.fail('Pedido inválido.');
 let sql,params;
 if(role==='kitchen'){
  const map={preparing:['accepted'],completed:['accepted','preparing'],returned_to_attendant:['accepted','preparing']};
  if(!Object.hasOwn(map,next))throw new AuthError('Ação não autorizada para cozinha.',403);
  const reason=next==='returned_to_attendant'?c.note(body.reason,400):null;
  if(next==='returned_to_attendant'&&!reason)c.fail('Informe o motivo da devolução.');
  sql="UPDATE dp.orders SET status=$3,return_reason=$4,updated_by=$2 WHERE request_id=$1 AND status=ANY($5::text[]) AND EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active AND (role='kitchen' OR (role='admin' AND lower(email)='opedrososamuel@gmail.com'))) RETURNING request_id,status";
  params=[id,actor.id,next,reason,map[next]];
 }else if(role==='courier'){
  if(next==='out_for_delivery'){
   sql="UPDATE dp.orders SET status='out_for_delivery',courier_id=$2,dispatched_at=now(),updated_by=$2 WHERE request_id=$1 AND status='completed' AND fulfillment->>'type'='delivery' AND courier_id IS NULL AND EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active AND (role='courier' OR (role='admin' AND lower(email)='opedrososamuel@gmail.com'))) RETURNING request_id,status";
  }else if(next==='delivered'){
   sql="UPDATE dp.orders SET status='delivered',delivered_at=now(),updated_by=$2 WHERE request_id=$1 AND status='out_for_delivery' AND (courier_id=$2 OR EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active AND role='admin' AND lower(email)='opedrososamuel@gmail.com')) AND EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active AND (role='courier' OR (role='admin' AND lower(email)='opedrososamuel@gmail.com'))) RETURNING request_id,status";
  }else throw new AuthError('Ação não autorizada para motoboy.',403);
  params=[id,actor.id];
 }else throw new AuthError('Perfil operacional inválido.',403);
 const rows=await db.run(sql,params);
 if(rows.length!==1)throw new db.StoreError('Pedido indisponível ou já movimentado. Atualize a fila.',409);
 return {order:rows[0]};
}
module.exports={restricted,queue,transition};
