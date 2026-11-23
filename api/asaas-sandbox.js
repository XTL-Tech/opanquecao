'use strict';
// Painel de homologação isolado: NÃO cria cobrança de produção nem pedido real.
// Credenciais do Asaas exclusivamente no servidor.
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const CANNONICAL='https://opanquecao.vercel.app';
const SANDBOX_API='https://api-sandbox.asaas.com/v3';
function apiHeaders(){return{Accept:'application/json','access_token':process.env.ASAAS_SANDBOX_API_KEY,
 'User-Agent':'XTL-DiskPanquecao-Checkout-Sandbox/1.0'};}
function errorCode(data){
 const code=String(data?.errors?.[0]?.code||data?.error?.code||'provider_error');
 return /^[A-Za-z0-9_-]{1,64}$/.test(code)?code:'provider_error';
}
function audit(event,detail={}) {
 console.warn(JSON.stringify({event,environment:'asaas-sandbox',...detail}));
}
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
  if(req.body?.action==='confirm_absent_sandbox_checkout'){
   if(req.body?.confirmation!=='CONFIRMO_AUSENCIA_NO_ASAAS')
    return safe(res,400,{error:'Confirmação explícita necessária.'});
   const answer=await db.sandboxConfirmAbsent(actor.id,req.body.recordId);
   audit('asaas_sandbox_manual_reconciliation',{providerCode:'CONFIRMED_ABSENT'});
   return safe(res,200,answer);
  }
  if(req.body?.action==='check_sandbox_connection'){
   // Diagnóstico somente-leitura, explicitamente solicitado por gestor autenticado.
   try{
    const check=await fetch(SANDBOX_API+'/myAccount/status/',{
     method:'GET',cache:'no-store',headers:apiHeaders(),signal:AbortSignal.timeout(7000)
    });
    let responseData={};try{responseData=await check.json();}catch{}
    const code=check.ok?'OK':errorCode(responseData);
    audit('asaas_sandbox_connection_check',{httpStatus:check.status,providerCode:code});
    return safe(res,200,{connected:check.ok,httpStatus:check.status,
     providerCode:code,environment:'sandbox'});
   }catch{
    audit('asaas_sandbox_connection_check',{httpStatus:null,providerCode:'NETWORK_ERROR'});
    return safe(res,200,{connected:false,httpStatus:null,providerCode:'NETWORK_ERROR',environment:'sandbox'});
   }
  }
  if(req.body?.action!=='create_sandbox_checkout')return safe(res,400,{error:'Operação inválida.'});
  const scenario=typeof req.body?.scenario==='string'?req.body.scenario:'both';
  if(!['both','pix','credit_card'].includes(scenario))
   return safe(res,400,{error:'Modalidade de checkout inválida.'});
  const claimed=await db.sandboxClaim(actor.id,scenario);
  if(!claimed.created){
   if(!claimed.record.provider_checkout_id)return safe(res,409,{error:'Checkout de teste pendente de reconciliação.'});
   return safe(res,200,{sandbox:true,reused:true,link:
    'https://asaas.com/checkoutSession/show?id='+encodeURIComponent(claimed.record.provider_checkout_id)});
  }
  const local=claimed.record;
  const base=CANNONICAL+'/backoffice/asaas-return.html?result=';
  const payload={
   billingTypes:scenario==='pix'?['PIX']:scenario==='credit_card'?['CREDIT_CARD']:['PIX','CREDIT_CARD'],
   chargeTypes:['DETACHED'],
   minutesToExpire:30,
   externalReference:local.external_ref,
   callback:{successUrl:base+'success',cancelUrl:base+'cancel',expiredUrl:base+'expired'},
   items:[{name:'Disk Panquecão — Teste Sandbox',description:'Pedido fictício de homologação, não preparar',quantity:1,value:local.amount_cents/100}]
  };
  let result,providerStatus=null,providerCode=null,stage='request';
  try{
   const response=await fetch(SANDBOX_API+'/checkouts',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json',...apiHeaders()},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(9000)
   });
   providerStatus=response.status;
   stage='response';
   result=await response.json();
   if(!response.ok){
    providerCode=errorCode(result);
    audit('asaas_sandbox_checkout_rejected',{httpStatus:providerStatus,providerCode,scenario});
    try{await db.sandboxMarkUncertain(local.id);}catch{audit('asaas_sandbox_state_failed',{scenario});}
    return safe(res,503,{error:'Asaas recusou a criação (HTTP '+providerStatus+
     ', código '+providerCode+'). Confira a configuração Sandbox e concilie antes de repetir.',
     providerStatus,providerCode});
   }
   if(typeof result?.id!=='string'||result.id.length<5||result.id.length>200||
    !/^[a-zA-Z0-9_-]+$/.test(result.id))throw Error('INVALID_PROVIDER_ID');
   stage='attach';
   await db.sandboxAttach(local.id,result.id);
  }catch{
   audit('asaas_sandbox_checkout_uncertain',{stage,httpStatus:providerStatus,
    providerCode:providerCode||'UNCONFIRMED',scenario});
   try{await db.sandboxMarkUncertain(local.id);}catch{audit('asaas_sandbox_state_failed',{scenario});}
   return safe(res,503,{error:'Não foi possível concluir o checkout (etapa '+stage+
    '). Confira o Asaas Sandbox antes de repetir.',providerStatus,providerCode:'UNCONFIRMED'});
  }
  return safe(res,201,{sandbox:true,scenario,amountCents:500,link:
   'https://asaas.com/checkoutSession/show?id='+encodeURIComponent(result.id)});
 }catch(e){
  const status=Number.isInteger(e.status)?e.status:503;
  return safe(res,status,{error:status===503?'Operação de teste temporariamente indisponível.':e.message});
 }
};
