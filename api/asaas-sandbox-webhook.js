'use strict';
const crypto=require('node:crypto');
const db=require('../lib/backoffice-neon');
const EVENTS=new Set(['CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_EXPIRED','CHECKOUT_CANCELED']);
function sameToken(a,b){
 if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
 const x=crypto.createHash('sha256').update(a).digest();
 const y=crypto.createHash('sha256').update(b).digest();
 return crypto.timingSafeEqual(x,y);
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método inválido.'});
 if(!db.configured()||process.env.ASAAS_SANDBOX_ENABLED!=='true'||
  !process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN)
  return res.status(503).json({error:'Webhook não habilitado.'});
 if(!sameToken(req.headers?.['asaas-access-token'],process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN))
  return res.status(401).json({error:'Não autorizado.'});
 const raw=req.body;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  JSON.stringify(raw).length>24000)return res.status(400).json({error:'Evento inválido.'});
 if(typeof raw.id!=='string'||raw.id.length>180||
  !/^[a-zA-Z0-9_-]+$/.test(raw.id)||
  typeof raw.checkout?.id!=='string'||raw.checkout.id.length>200||
  !/^[a-zA-Z0-9_-]+$/.test(raw.checkout.id)||
  !EVENTS.has(raw.event))return res.status(400).json({error:'Evento não reconhecido.'});
 const external=typeof raw.checkout.externalReference==='string'
  ?raw.checkout.externalReference.slice(0,200):'';
 try{
  await db.sandboxEvent({id:raw.id,checkout:raw.checkout.id,event:raw.event,externalReference:external});
  // Sandbox nunca registra venda real, nem Payment/Purchase no Meta Pixel.
  return res.status(200).json({ok:true});
 }catch{
  return res.status(503).json({error:'Falha temporária; reenvie o webhook.'});
 }
};
