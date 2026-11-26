'use strict';
const db=require('./backoffice-neon');
const c=require('./backoffice-core');
const {AuthError}=require('./backoffice-neon-auth');
function guard(actor){if(!['manager','attendant','admin'].includes(actor.role))throw new AuthError('Acesso não autorizado.',403);}
async function queue(actor){
 guard(actor);
 const rows=await db.run("SELECT a.request_id,a.state,a.due_at,a.due_at<=now() AS due,a.claimed_by=$1 AS mine,a.note,o.ref_code,c.name AS customer_name,c.phone AS customer_phone FROM dp.after_sales a JOIN dp.orders o ON o.request_id=a.request_id JOIN dp.customers c ON c.id=o.customer_id WHERE o.status='delivered' AND a.state IN ('pending','claimed','contacted','issue') ORDER BY CASE WHEN a.state='pending' AND a.due_at<=now() THEN 0 WHEN a.state='issue' THEN 1 ELSE 2 END,a.due_at LIMIT 80",[actor.id]);
 return {tasks:rows};
}
async function change(actor,body){
 guard(actor);
 const id=body.id,next=body.next;
 if(typeof id!=='string'||!c.UUID.test(id))c.fail('Pedido inválido.');
 const note=c.note(body.note,400);
 if(next==='issue'&&!note)c.fail('Descreva o problema relatado.');
 const conditions={
  claimed:"state='pending' AND due_at<=now()",
  contacted:"state='claimed' AND claimed_by=$2",
  satisfied:"state IN ('contacted','issue') AND claimed_by=$2",
  issue:"state='contacted' AND claimed_by=$2",
  no_response:"state='contacted' AND claimed_by=$2",
  pending:"state='claimed' AND claimed_by=$2"
 };
 if(!Object.hasOwn(conditions,next))c.fail('Movimentação inválida.');
 const sets={
  claimed:"state='claimed',claimed_by=$2,claimed_at=now()",
  contacted:"state='contacted',contacted_at=now()",
  satisfied:"state='satisfied',resolved_at=now(),note=$3",
  issue:"state='issue',note=$3",
  no_response:"state='no_response',resolved_at=now(),note=$3",
  pending:"state='pending',claimed_by=NULL,claimed_at=NULL"
 };
 const withNote=['satisfied','issue','no_response'].includes(next);
 const result=await db.run("UPDATE dp.after_sales SET "+sets[next]+",updated_by=$2,updated_at=now() WHERE request_id=$1 AND "+conditions[next]+" AND EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active AND role IN ('manager','attendant','admin')) AND EXISTS(SELECT 1 FROM dp.orders WHERE request_id=$1 AND status='delivered') RETURNING request_id,state",[id,actor.id,...(withNote?[note]:[])]);
 if(result.length!==1)throw new db.StoreError('Tarefa ainda não disponível ou já assumida. Atualize a fila.',409);
 return {task:result[0]};
}
module.exports={queue,change};
