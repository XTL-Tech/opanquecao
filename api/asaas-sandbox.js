'use strict';
// Painel de homologação isolado: NÃO cria cobrança de produção nem pedido real.
// Credenciais do Asaas exclusivamente no servidor.
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const CANNONICAL='https://opanquecao.vercel.app';
function safe(res,status,data){res.setHeader('Cache-Control','private, no-store');return res.status(status).json(data);}
module.exports=async function handler(req,res){
 try{
  if(!db.configured()||!auth.configured())return safe(res,503,{error:'Ative primeiro o Neon e o login do atendente.'});
  const actor=await auth.actor(req);
  if(actor.role!=='manager')return safe(res,403,{error:'Teste de pagamentos disponível somente para gestão.'});
  if(req.method==='GET'){
   return safe(res,200,{mode:'sandbox',enabled:process.env.ASAAS_SANDBOX_ENABLED==='true'&&
    !!process.env.ASAAS_SANDBOX_API_KEY&&!!process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN,
    recent:await db.sandboxRecent(actor.id)});
  }
  if(req.method!=='POST')return safe(res,405,{error:'Método inválido.'});
  auth.originGuard(req);
  if(process.env.ASAAS_SANDBOX_ENABLED!=='true'||!process.env.ASAAS_SANDBOX_API_KEY||
   !process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN)
   return safe(res,503,{error:'Sandbox ainda não configurado na Vercel.'});
  if(req.body?.action!=='create_sandbox_checkout')return safe(res,400,{error:'Operação inválida.'});
  const claimed=await db.sandboxClaim(actor.id);
  if(!claimed.created){
   if(!claimed.record.provider_checkout_id)return safe(res,409,{error:'Checkout de teste pendente de reconciliação.'});
   return safe(res,200,{sandbox:true,reused:true,link:
    'https://asaas.com/checkoutSession/show?id='+encodeURIComponent(claimed.record.provider_checkout_id)});
  }
  const local=claimed.record;
  const base=CANNONICAL+'/backoffice/asaas-return.html?result=';
  const payload={
   billingTypes:['PIX','CREDIT_CARD'],
   chargeTypes:['DETACHED'],
   minutesToExpire:30,
   externalReference:local.external_ref,
   callback:{successUrl:base+'success',cancelUrl:base+'cancel',expiredUrl:base+'expired'},
   items:[{name:'Disk Panquecão — Teste Sandbox',description:'Pedido fictício de homologação, não preparar',quantity:1,value:local.amount_cents/100}]
  };
  let result;
  try{
   const response=await fetch('https://api-sandbox.asaas.com/v3/checkouts',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json',Accept:'application/json',
     'access_token':process.env.ASAAS_SANDBOX_API_KEY,
     'User-Agent':'XTL-DiskPanquecao-Checkout-Sandbox/1.0'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(9000)
   });
   result=await response.json();
   if(!response.ok||typeof result?.id!=='string'||result.id.length<5||result.id.length>200||
    !/^[a-zA-Z0-9_-]+$/.test(result.id))
    throw Error('Asaas não retornou identificador utilizável.');
   await db.sandboxAttach(local.id,result.id);
  }catch{
   try{await db.sandboxMarkUncertain(local.id);}catch{}
   return safe(res,503,{error:'Criação de checkout incerta. Verifique no Asaas Sandbox antes de repetir.'});
  }
  return safe(res,201,{sandbox:true,amountCents:500,link:
   'https://asaas.com/checkoutSession/show?id='+encodeURIComponent(result.id)});
 }catch(e){
  const status=Number.isInteger(e.status)?e.status:503;
  return safe(res,status,{error:status===503?'Operação de teste temporariamente indisponível.':e.message});
 }
};
