'use strict';
const {createHash,randomBytes,timingSafeEqual}=require('node:crypto');
const {UUID_V4}=require('./order-idempotency');
const { assertNoGlobalSecretOnShared, isSharedFoodDatabase } = require('./food-db-policy');
const { signedRequest, callFoodGateway } = require('./food-gateway-client');
const RESTAURANT_ID='opanquecao';
class ReviewUnavailable extends Error {}
const enabled=()=>process.env.ORDER_APPROVAL_MODE==='required';
function trackingToken(){return randomBytes(32).toString('base64url');}
function tokenDigest(token){return createHash('sha256').update(token).digest('hex');}
function tokenMatches(token,hash){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))return false;
 return timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(tokenDigest(token),'hex'));
}
function initReviewStore(){
 if(!enabled()||process.env.ORDER_LEDGER_MODE!=='required')throw new ReviewUnavailable('Revisão requer ledger persistente');
 if(isSharedFoodDatabase()){
  try{signedRequest('store.get',{});}catch{throw new ReviewUnavailable('Gateway privado Food não configurado');}
  return {
   async get(requestId){
    if(!UUID_V4.test(requestId))throw new TypeError('Identificador inválido');
    try{return (await callFoodGateway('review.get',{requestId}))[0]||null;}
    catch{throw new ReviewUnavailable('Consulta de revisão indisponível');}
   },
   async create({requestId,orderRef,token,name,phone,items,fulfillment,payment,subtotal,fee}){
    if(!UUID_V4.test(requestId)||!/^[0-9a-f]{8}$/.test(orderRef)||
       typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new TypeError('Identificador inválido');
    try{
     const rows=await callFoodGateway('review.create',{requestId,orderRef,trackingSha256:tokenDigest(token),
      name,phone,items,fulfillment,payment,subtotal,fee});
     if(rows.length!==1)throw new Error('Conflito no registro');
     return rows[0];
    }catch{throw new ReviewUnavailable('Pré-pedido não registrado');}
   },
   async setTelegram(requestId,messageId){
    if(!UUID_V4.test(requestId)||!Number.isSafeInteger(messageId)||messageId<=0)throw new TypeError('Mensagem inválida');
    try{
     const rows=await callFoodGateway('review.set_telegram',{requestId,messageId});
     if(rows.length!==1)throw new Error('Conflito de mensagem');
     return rows[0];
    }catch{throw new ReviewUnavailable('Vinculação Telegram indisponível');}
   },
   async decide(requestId,status,actorId,reason=null,messageId=null){
    if(!UUID_V4.test(requestId)||!['approved','rejected','delivery_uncertain'].includes(status)||
       (status==='rejected'&&!(typeof reason==='string'&&reason.length>=5&&reason.length<=220))||
       (status!=='delivery_uncertain'&&(!Number.isSafeInteger(actorId)||actorId<=0||
           !Number.isSafeInteger(messageId)||messageId<=0)))throw new TypeError('Decisão inválida');
    try{return (await callFoodGateway('review.decide',{requestId,status,actorId,reason,messageId}))[0]||null;}
    catch{throw new ReviewUnavailable('Decisão indisponível');}
   }
  };
 }
 try { assertNoGlobalSecretOnShared(); }
 catch { throw new ReviewUnavailable('Banco compartilhado exige acesso restrito por aplicativo'); }
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(typeof url!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!key)throw new ReviewUnavailable('Banco dedicado não configurado');
 const base=url+'/rest/v1/restaurant_preorder_reviews';
 const filter=id=>'?restaurant_id=eq.'+RESTAURANT_ID+'&request_id=eq.'+encodeURIComponent(id);
 async function request(path,opt={}){
  let r;try{r=await fetch(base+path,{...opt,cache:'no-store',headers:{apikey:key,Accept:'application/json',...(opt.headers||{})},signal:AbortSignal.timeout(5000)});}
  catch{throw new ReviewUnavailable('Conexão ao banco indisponível');}
  if(!r.ok)throw new ReviewUnavailable('Consulta ao banco recusada');
  try{const a=await r.json();if(!Array.isArray(a))throw Error('rows');return a;}
  catch{throw new ReviewUnavailable('Resposta inválida do banco');}
 }
 async function get(id){
  if(!UUID_V4.test(id))throw new TypeError('Identificador inválido');
  const rows=await request(filter(id)+'&select=*&limit=1');return rows[0]||null;
 }
 async function create({requestId,orderRef,token,name,phone,items,fulfillment,payment,subtotal,fee}){
  if(!UUID_V4.test(requestId)||!/^[0-9a-f]{8}$/.test(orderRef)||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new TypeError('Identificador inválido');
  const rows=await request('?on_conflict=restaurant_id,request_id',{method:'POST',
   headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},
   body:JSON.stringify({restaurant_id:RESTAURANT_ID,request_id:requestId,order_ref:orderRef,tracking_sha256:tokenDigest(token),
    customer_name:name,customer_phone:phone,items_snapshot:items,fulfillment_snapshot:fulfillment,
    payment_snapshot:payment,subtotal_cents:subtotal,delivery_fee_cents:fee,status:'pending_review'})});
  if(rows.length!==1)throw new ReviewUnavailable('Pedido já cadastrado ou identificador em conflito');return rows[0];
 }
 async function setTelegram(id,messageId){
  if(!Number.isSafeInteger(messageId)||messageId<=0)throw new TypeError('Mensagem Telegram inválida');
  const rows=await request(filter(id)+'&status=eq.pending_review',{method:'PATCH',
   headers:{'Content-Type':'application/json',Prefer:'return=representation'},
   body:JSON.stringify({telegram_message_id:messageId,updated_at:new Date().toISOString()})});
  if(rows.length!==1)throw new ReviewUnavailable('Não foi possível vincular o Telegram');return rows[0];
 }
 async function decide(id,status,actorId,reason=null,messageId=null){
  if(!['approved','rejected','delivery_uncertain'].includes(status)||!UUID_V4.test(id)||
     (status==='rejected'&&!(typeof reason==='string'&&reason.length>=5&&reason.length<=220)))
    throw new TypeError('Decisão inválida');
  if(status!=='delivery_uncertain'&&(!Number.isSafeInteger(actorId)||actorId<=0||!Number.isSafeInteger(messageId)||messageId<=0))
    throw new TypeError('Atendente/mensagem inválidos');
  const path=filter(id)+'&status=eq.pending_review'+(status==='delivery_uncertain'?'':'&telegram_message_id=eq.'+messageId);
  const rows=await request(path,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
   body:JSON.stringify({status,rejection_reason:status==='rejected'?reason:null,
    reviewed_by:status==='delivery_uncertain'?null:actorId,reviewed_at:status==='delivery_uncertain'?null:new Date().toISOString(),
    updated_at:new Date().toISOString()})});
  return rows[0]||null;
 }
 return {get,create,setTelegram,decide};
}
module.exports={RESTAURANT_ID,ReviewUnavailable,enabled,trackingToken,tokenDigest,tokenMatches,initReviewStore};
