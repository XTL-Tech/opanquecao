'use strict';
const db=require('./backoffice-neon'),core=require('./backoffice-core');
const cpf=require('./customer-cpf');
const enabled=()=>process.env.DIGITAL_ORDERS_ENABLED==='true';
function allowedRole(role){return ['manager','admin'].includes(role);}
function allowedAction(method,action){
 return (method==='GET'?['session','dashboard','catalog','customers','orders','events','store_operations','delivery_map','account_history']:['customer_save','order_status','order_fee','order_paid','catalog_price','store_operations_save','account_search']).includes(action);
}
async function accounts(term){
 const raw=typeof term==='string'?term.trim().slice(0,80):'';
 let hash=null;
 if(/^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(raw)){try{hash=cpf.fingerprint(raw).hash;}catch(e){if(e.status===503)throw e;}}
 const digits=raw.replace(/\D/g,'');
 return db.run("SELECT a.subject,a.name,a.phone,a.cpf_last2, count(o.request_id)::int AS orders, max(o.created_at) AS last_order FROM dp.customer_accounts a LEFT JOIN dp.orders o ON o.account_subject=a.subject WHERE a.cpf_hash IS NOT NULL AND ($1='' OR lower(a.name) LIKE $2 OR ($3<>'' AND a.phone LIKE $3||'%') OR ($4::text IS NOT NULL AND a.cpf_hash=$4)) GROUP BY a.subject,a.name,a.phone,a.cpf_last2 ORDER BY max(o.created_at) DESC NULLS LAST,a.subject LIMIT 100",[raw,raw.toLowerCase()+'%',digits,hash]);
}
async function history(subject){
 if(typeof subject!=='string'||subject.length<4||subject.length>150)core.fail('Conta inválida.');
 return db.run('SELECT ref_code,status,items,fulfillment,subtotal_cents,delivery_fee_cents,created_at FROM dp.orders WHERE account_subject=$1 ORDER BY created_at DESC LIMIT 100',[subject]);
}
async function deliveryMap(){
 const rows=await db.run("SELECT ref_code,fulfillment,created_at FROM dp.orders WHERE fulfillment->>'type'='delivery' ORDER BY created_at DESC LIMIT 500");
 return rows.map(x=>{const f=x.fulfillment||{},p=f.location;const valid=p&&typeof p.latitude==='number'&&typeof p.longitude==='number'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;return{ref:x.ref_code,address:[f.street,f.number,f.neighborhood,f.city,'RS','Brasil'].filter(Boolean).join(', '),location:valid?{latitude:p.latitude,longitude:p.longitude}:null};});
}
module.exports={enabled,allowedRole,allowedAction,accounts,history,deliveryMap};
