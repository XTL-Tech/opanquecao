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
 const name=body.name?c.name(body.name):null,phone=body.phone?c.phone(body.phone):null;
 const rows=await db.run("SELECT tab_id AS id,customer_name,table_number,cpf_suffix FROM dp.open_customer_comanda($1,$2,$3,$4,$5,$6,$7)",[key,x.slice(-2),table,name,phone,actor.id,body.confirmExisting===true]);
 if(!rows.length)throw new db.StoreError('Confira o cadastro e a mesa. Se o telefone já existe, confirme o nome do titular antes de vincular. CPF ou comanda de outro cliente não serão alterados.',409);
 return {tab:rows[0]};
}
async function lookupCustomer(actor,body){
 guard(actor);const key=keyFor(cpf(body.cpf));
 const rows=await db.run("SELECT c.name AS customer_name,c.cpf_suffix,t.id AS tab_id,t.table_number FROM dp.customers c LEFT JOIN dp.comandas t ON t.customer_id=c.id AND t.state='open' WHERE c.cpf_key=$1 LIMIT 1",[key]);
 return {customer:rows[0]||null};
}
async function context(actor,id){
 guard(actor);if(typeof id!=='string'||!c.UUID.test(id))c.fail('Comanda inválida.');
 const rows=await db.run("SELECT t.id,t.customer_id,t.table_number,c.name,c.phone FROM dp.comandas t JOIN dp.customers c ON c.id=t.customer_id WHERE t.id=$1 AND t.state='open'",[id]);
 if(!rows.length)throw new db.StoreError('Comanda não disponível.',409);return rows[0];
}
async function find(actor,body){
 guard(actor);const key=keyFor(cpf(body.cpf));
 const rows=await db.run("SELECT t.id,t.table_number,t.cpf_suffix,c.name AS customer_name FROM dp.comandas t JOIN dp.customers c ON c.id=t.customer_id WHERE t.cpf_key=$1 AND t.state='open' LIMIT 1",[key]);
 if(!rows.length)throw new db.StoreError('Nenhuma comanda aberta para este CPF.',404);
 return {tab:rows[0]};
}
async function close(actor,body){
 guard(actor);if(typeof body.id!=='string'||!c.UUID.test(body.id))c.fail('Comanda inválida.');
 const rows=await db.run("SELECT dp.close_comanda($1,$2) AS id",[body.id,actor.id]);
 if(!rows[0]?.id)throw new db.StoreError('Finalize e registre o pagamento dos pedidos antes de fechar a comanda.',409);
 return {id:rows[0].id};
}
module.exports={list,open,context,find,close,cpf,keyFor,lookupCustomer};
