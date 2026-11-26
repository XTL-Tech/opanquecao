'use strict';
const crypto=require('node:crypto');
const db=require('./backoffice-neon');
const c=require('./backoffice-core');
const {AuthError}=require('./backoffice-neon-auth');
function guard(actor){if(!['admin','manager','attendant'].includes(actor.role))throw new AuthError('Comandas restritas ao atendimento e administração.',403);}
function cpf(value){
 const x=String(value??'').replace(/[.\-\s]/g,'');
 if(!/^\d{11}$/.test(x)||/^(\d)\1{10}$/.test(x))c.fail('CPF inválido.');
 for(const n of [9,10]){
  let sum=0;for(let i=0;i<n;i++)sum+=Number(x[i])*(n+1-i);
  if((sum*10%11)%10!==Number(x[n]))c.fail('CPF inválido.');
 }
 return x;
}
function keyFor(x){
 const key=process.env.COMANDA_CPF_HMAC_KEY||'';
 if(!/^[a-f0-9]{64}$/i.test(key))throw new db.StoreError('Identificação por CPF ainda não configurada.',503);
 return crypto.createHmac('sha256',Buffer.from(key,'hex')).update(x).digest('hex');
}
async function list(actor){
 guard(actor);
 const rows=await db.run("SELECT t.id,t.table_number,t.cpf_suffix,t.opened_at,c.name AS customer_name,count(o.request_id)::int AS orders,coalesce(sum(o.subtotal_cents) FILTER(WHERE o.status<>'cancelled'),0)::bigint AS total_cents,coalesce(sum(o.subtotal_cents) FILTER(WHERE o.status<>'cancelled' AND o.payment_status='pending'),0)::bigint AS pending_cents,count(o.request_id) FILTER(WHERE NOT(o.status='cancelled' OR (o.status='delivered' AND o.payment_status='paid')))::int AS unfinished FROM dp.comandas t JOIN dp.customers c ON c.id=t.customer_id LEFT JOIN dp.orders o ON o.comanda_id=t.id WHERE t.state='open' GROUP BY t.id,c.name ORDER BY t.table_number,t.opened_at LIMIT 200");
 return {tabs:rows,cpfEnabled:/^[a-f0-9]{64}$/i.test(process.env.COMANDA_CPF_HMAC_KEY||'')};
}
async function open(actor,body){
 guard(actor);const x=cpf(body.cpf),key=keyFor(x),table=Number(body.table);
 if(!Number.isInteger(table)||table<1||table>999)c.fail('Número da mesa inválido.');
 const name=c.name(body.name),phone=c.phone(body.phone);
 // Insertion and conflict handling are atomic; never return another customer's tab.
 const rows=await db.run("WITH customer AS (INSERT INTO dp.customers(name,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET phone=excluded.phone RETURNING id) INSERT INTO dp.comandas(customer_id,cpf_key,cpf_suffix,table_number,opened_by) SELECT id,$3,$4,$5,$6 FROM customer ON CONFLICT(cpf_key) WHERE state='open' DO NOTHING RETURNING id,table_number",[name,phone,key,x.slice(-2),table,actor.id]);
 if(!rows.length)throw new db.StoreError('CPF já possui comanda aberta. Consulte a fila antes de continuar.',409);
 return {tab:rows[0]};
}
async function context(actor,id){
 guard(actor);if(typeof id!=='string'||!c.UUID.test(id))c.fail('Comanda inválida.');
 const rows=await db.run("SELECT t.id,t.customer_id,t.table_number,c.name,c.phone FROM dp.comandas t JOIN dp.customers c ON c.id=t.customer_id WHERE t.id=$1 AND t.state='open'",[id]);
 if(!rows.length)throw new db.StoreError('Comanda não disponível.',409);return rows[0];
}
async function close(actor,body){
 guard(actor);if(typeof body.id!=='string'||!c.UUID.test(body.id))c.fail('Comanda inválida.');
 const rows=await db.run("SELECT dp.close_comanda($1,$2) AS id",[body.id,actor.id]);
 if(!rows[0]?.id)throw new db.StoreError('Finalize e registre o pagamento dos pedidos antes de fechar a comanda.',409);
 return {id:rows[0].id};
}
module.exports={list,open,context,close,cpf,keyFor};
