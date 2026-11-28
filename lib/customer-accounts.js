'use strict';
const db=require('./backoffice-neon');
const c=require('./backoffice-core');
const {AccountError}=require('./customer-auth');
const areas=require('../delivery-areas.json');
const cpf=require('./customer-cpf');
async function profile(subject){
 await db.run('INSERT INTO dp.customer_accounts(subject) VALUES($1) ON CONFLICT(subject) DO NOTHING',[subject]);
 return (await db.run(cpf.enabled()?'SELECT name,phone,(cpf_hash IS NOT NULL) AS "hasCpf",cpf_last2 AS "cpfLast2" FROM dp.customer_accounts WHERE subject=$1':'SELECT name,phone FROM dp.customer_accounts WHERE subject=$1',[subject]))[0];
}
async function saveProfile(subject,body){
 const name=c.name(body.name),phone=c.phone(body.phone);
 await profile(subject);
 if(cpf.enabled()){
  const f=body.cpf?cpf.fingerprint(body.cpf):null;
  try{
   const rows=await db.run('UPDATE dp.customer_accounts SET name=$2,phone=$3,cpf_hash=coalesce(cpf_hash,$4),cpf_last2=coalesce(cpf_last2,$5),updated_at=now() WHERE subject=$1 AND (cpf_hash IS NOT NULL OR $4::text IS NOT NULL) AND ($4::text IS NULL OR cpf_hash IS NULL OR cpf_hash=$4) RETURNING name,phone,true AS "hasCpf",cpf_last2 AS "cpfLast2"',[subject,name,phone,f?.hash||null,f?.last2||null]);
   if(rows.length!==1)throw new AccountError('Informe o CPF ou contate a loja para corrigir o cadastro.',409);
   return rows[0];
  }catch(e){if(e.status===409)throw new AccountError('Não foi possível vincular o CPF. Confira seus dados ou contate a loja.',409);throw e;}
 }
 return (await db.run('UPDATE dp.customer_accounts SET name=$2,phone=$3,updated_at=now() WHERE subject=$1 RETURNING name,phone',[subject,name,phone]))[0];
}
function id(value){if(typeof value!=='string'||!c.UUID.test(value))throw new AccountError('Endereço inválido.');return value;}
async function list(subject,after){
 if(after)id(after);
 const rows=await db.run('SELECT id,label,data,revision FROM dp.customer_addresses WHERE owner_subject=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 51',[subject,after||null]);
 const more=rows.length>50,addresses=rows.slice(0,50);
 return {addresses,next:more?addresses.at(-1).id:null};
}
async function validateAddress(body){
 const label=c.tidy(body.label,50);
 if(!label||label.length>50)throw new AccountError('Informe um apelido para o endereço.');
 const raw=body.address;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AccountError('Endereço inválido.');
 const {normalizeFulfillment}=await import('../fulfillment.mjs');
 let n;try{n=normalizeFulfillment({...raw,type:'delivery'},areas);}catch(e){throw new AccountError(e.message);}
 // Do not store GPS by default. Keep the explicit unknown-neighborhood selection.
 const data={city:n.city,neighborhood:raw.neighborhood==='__other__'?'__other__':n.neighborhood,otherNeighborhood:raw.neighborhood==='__other__'?n.neighborhood:'',street:n.street,number:n.number,complement:n.complement,reference:n.reference};
 return {label,data};
}
async function saveAddress(subject,body){
 const {label,data}=await validateAddress(body);await profile(subject);
 let rows;
 if(body.id){
  if(!Number.isSafeInteger(body.revision)||body.revision<1)throw new AccountError('Atualize o endereço antes de editar.',409);
  rows=await db.run('UPDATE dp.customer_addresses SET label=$3,data=$4::jsonb,revision=revision+1,updated_at=now() WHERE owner_subject=$1 AND id=$2 AND revision=$5 RETURNING id,label,data,revision',[subject,id(body.id),label,JSON.stringify(data),body.revision]);
 }else rows=await db.run('INSERT INTO dp.customer_addresses(owner_subject,label,data) VALUES($1,$2,$3::jsonb) RETURNING id,label,data,revision',[subject,label,JSON.stringify(data)]);
 if(!rows.length)throw new AccountError('Endereço não encontrado ou alterado. Atualize a lista.',409);
 return rows[0];
}
async function removeAddress(subject,body){
 if(!Number.isSafeInteger(body.revision)||body.revision<1)throw new AccountError('Atualize a lista.',409);
 const rows=await db.run('DELETE FROM dp.customer_addresses WHERE owner_subject=$1 AND id=$2 AND revision=$3 RETURNING id',[subject,id(body.id),body.revision]);
 if(!rows.length)throw new AccountError('Endereço não encontrado ou alterado.',409);
 return {removed:true};
}
async function orders(subject){return db.run('SELECT ref_code,status,items,fulfillment,subtotal_cents,delivery_fee_cents,created_at FROM dp.orders WHERE account_subject=$1 ORDER BY created_at DESC LIMIT 100',[subject]);}
module.exports={profile,saveProfile,list,validateAddress,saveAddress,removeAddress,orders};
