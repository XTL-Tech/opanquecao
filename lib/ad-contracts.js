'use strict';
const db=require('./backoffice-neon'),c=require('./backoffice-core'),{AuthError}=require('./backoffice-neon-auth');
function guard(actor){if(!['admin','manager'].includes(actor.role))throw new AuthError('Publicidade restrita à administração.',403);}
function text(v,max,min=0){const x=String(v??'').trim();if(x.length<min||x.length>max)c.fail('Confira os campos do contrato.');return x;}
function destination(v){const x=text(v,500);if(!x)return '';let u;try{u=new URL(x);}catch{c.fail('Link inválido.');}if(u.protocol!=='https:'||u.username||u.password)c.fail('Use um link HTTPS válido.');return u.href;}
function media(v){const x=text(v,180);if(x&&!/^\/img\/parceiros\/[a-z0-9_-]+\.(webp|png|jpg)$/i.test(x))c.fail('Use uma arte local aprovada pela XTL.');return x;}
async function list(actor){guard(actor);const rows=await db.run("SELECT *,((now() AT TIME ZONE 'America/Sao_Paulo')::date) AS today FROM dp.ad_contracts ORDER BY ends_on DESC LIMIT 200");return {contracts:rows};}
async function save(actor,b){
 guard(actor);
 const start=c.isoDate(b.startsOn),end=c.isoDate(b.endsOn),due=c.isoDate(b.dueOn);
 if(end<start)c.fail('Vigência inválida.');
 const amount=c.cents(b.amountCents,10000000),paid=c.cents(b.paidCents,10000000);
 if(paid>amount)c.fail('Recebimento superior ao contrato.');
 const state=b.state;if(!['draft','active','paused','ended'].includes(state))c.fail('Situação inválida.');
 const ref=text(b.contractRef,120);if(state==='active'&&!ref)c.fail('Informe a referência do contrato aprovado.');
 const secs=Number(b.seconds);if(!Number.isInteger(secs)||secs<5||secs>60)c.fail('Duração entre 5 e 60 segundos.');
 const slot=Number(b.slot);if(![2,3].includes(slot))c.fail('Escolha a vaga 2 ou 3.');
 if(/^xtl(?:\s+tech)?$/i.test(text(b.advertiser,80,2)))c.fail('XTL TECH possui uma vaga permanente.');
 const p=[text(b.advertiser,80,2),text(b.contact,160),ref,text(b.notes,500),start,end,due,amount,paid,state,text(b.headline,100,2),text(b.description,240),destination(b.destination),media(b.mediaPath),secs,b.showTV===true,b.showCheckout===true,actor.id,slot];
 let rows;
 if(b.id){
  if(!c.UUID.test(b.id)||!Number.isInteger(b.revision)||b.revision<1)c.fail('Contrato inválido.');
  rows=await db.run("UPDATE dp.ad_contracts SET (advertiser,contact,contract_ref,notes,starts_on,ends_on,due_on,amount_cents,paid_cents,state,headline,description,destination,media_path,seconds,show_tv,show_checkout,updated_by,slot)=($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19),revision=revision+1,updated_at=now() WHERE id=$20 AND revision=$21 RETURNING id,revision",[...p,b.id,b.revision]);
 }else rows=await db.run("INSERT INTO dp.ad_contracts(advertiser,contact,contract_ref,notes,starts_on,ends_on,due_on,amount_cents,paid_cents,state,headline,description,destination,media_path,seconds,show_tv,show_checkout,updated_by,created_by,slot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19) RETURNING id,revision",p);
 if(rows.length!==1)throw new db.StoreError('Contrato alterado por outro operador. Atualize a tela.',409);
 return {contract:rows[0]};
}
// Public projection: no private terms, dates of payment, contact, customer, or operator data.
async function playlist(){
 const rows=await db.run("SELECT slot,advertiser AS name,headline,description,destination AS url,media_path AS media,seconds,show_tv,show_checkout,((ends_on+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AS expires_at FROM dp.ad_contracts WHERE state='active' AND starts_on<=(now() AT TIME ZONE 'America/Sao_Paulo')::date AND ends_on>=(now() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY slot LIMIT 2");
 return {ads:[{slot:1,name:'XTL TECH',headline:'Tecnologia que conecta o seu pedido à nossa cozinha',description:'XTL — Feito para durar.',url:'',media:'',seconds:15,tv:true,checkout:true,expiresAt:'2100-01-01T00:00:00Z'},...rows.map(x=>({slot:x.slot,name:x.name,headline:x.headline,description:x.description,url:destination(x.url),media:media(x.media),seconds:x.seconds,tv:x.show_tv===true,checkout:x.show_checkout===true,expiresAt:x.expires_at}))],generatedAt:new Date().toISOString()};
}
module.exports={list,save,playlist};
