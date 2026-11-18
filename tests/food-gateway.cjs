'use strict';
const assert=require('node:assert/strict');
const {generateKeyPairSync,verify,createHash,randomUUID}=require('node:crypto');
const gateway=require('../lib/food-gateway-client');
const {initLedger}=require('../lib/order-idempotency');
const {initReviewStore,trackingToken,tokenDigest}=require('../lib/order-review');
const {loadStoreStatus}=require('../lib/store-hours-source');
const {SHARED_XTL_REF}=require('../lib/food-db-policy');
(async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const private64=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
 const previous={...process.env};
 const originalFetch=global.fetch;
 const base='https://'+SHARED_XTL_REF+'.supabase.co';
 try{
  Object.assign(process.env,{
   FOOD_DB_TOPOLOGY:'shared',SUPABASE_URL:base,
   FOOD_GATEWAY_URL:base+'/functions/v1/xtl-food-gateway',
   FOOD_GATEWAY_PRIVATE_KEY_B64:private64,
   ORDER_LEDGER_MODE:'required',ORDER_APPROVAL_MODE:'required',STORE_HOURS_MODE:'required'
  });
  delete process.env.SUPABASE_SECRET_KEY;
  const now=Date.now(),req=gateway.signedRequest('store.get',{},process.env,now);
  const digest=createHash('sha256').update(req.body).digest('hex');
  const canonical=now+'\nPOST\n/xtl-food-gateway\n'+req.headers['x-xtl-food-nonce']+'\n'+digest;
  assert.equal(verify(null,Buffer.from(canonical),publicKey,Buffer.from(req.headers['x-xtl-food-signature'],'base64url')),true);
  assert.equal(verify(null,Buffer.from(canonical+'wrong'),publicKey,Buffer.from(req.headers['x-xtl-food-signature'],'base64url')),false);
  const sameTimestamp=gateway.signedRequest('store.get',{},process.env,now);
  assert.notEqual(req.headers['x-xtl-food-nonce'],sameTimestamp.headers['x-xtl-food-nonce']);
  assert.notEqual(req.headers['x-xtl-food-signature'],sameTimestamp.headers['x-xtl-food-signature']);
  const tampered=canonical.replace(req.headers['x-xtl-food-nonce'],sameTimestamp.headers['x-xtl-food-nonce']);
  assert.equal(verify(null,Buffer.from(tampered),publicKey,
    Buffer.from(req.headers['x-xtl-food-signature'],'base64url')),false,'nonce cannot be changed');
  assert.throws(()=>gateway.signedRequest('some.other.table',{}),gateway.FoodGatewayUnavailable);
  assert.throws(()=>gateway.signedRequest('store.get',{},{
   ...process.env,FOOD_GATEWAY_URL:'https://example.supabase.co/functions/v1/xtl-food-gateway'
  }),gateway.FoodGatewayUnavailable);
  assert.throws(()=>gateway.signedRequest('store.get',{},{
   ...process.env,SUPABASE_SECRET_KEY:'forbidden-placeholder'
  }),gateway.FoodGatewayUnavailable);
  const ledgerDb=new Map(),reviewDb=new Map(),operations=[];
  global.fetch=async(url,opt)=>{
   assert.equal(url,base+'/functions/v1/xtl-food-gateway');
   assert.equal(opt.method,'POST');
   assert.equal(opt.headers['content-type'],'application/json');
   const payload=JSON.parse(opt.body),stamp=opt.headers['x-xtl-food-time'];
   const canonical=stamp+'\nPOST\n/xtl-food-gateway\n'+opt.headers['x-xtl-food-nonce']+'\n'+createHash('sha256').update(opt.body).digest('hex');
   assert.equal(verify(null,Buffer.from(canonical),publicKey,
    Buffer.from(opt.headers['x-xtl-food-signature'],'base64url')),true);
   operations.push(payload.action);
   const i=payload.input;let rows=[];
   switch(payload.action){
    case 'store.get':
     rows=[{restaurant_id:'opanquecao',time_zone:'America/Sao_Paulo',accepting_orders:true,
      enforce_opening_hours:false,weekly_schedule:{},holiday_exceptions:{},
      manual_state:'open',manual_override_until:'2999-01-01T00:00:00Z'}];break;
    case 'ledger.lookup': rows=ledgerDb.has(i.requestId)?[ledgerDb.get(i.requestId)]:[];break;
    case 'ledger.claim':
     if(!ledgerDb.has(i.requestId)){
      const record={request_id:i.requestId,payload_sha256:i.digest,status:'processing',order_ref:i.orderRef};
      ledgerDb.set(i.requestId,record);rows=[record];
     }break;
    case 'ledger.finish':{
     const current=ledgerDb.get(i.requestId);
     if(current&&current.status==='processing'){current.status=i.status;rows=[current];}
     break;}
    case 'review.get':rows=reviewDb.has(i.requestId)?[reviewDb.get(i.requestId)]:[];break;
    case 'review.create':
     if(!reviewDb.has(i.requestId)){
      const row={request_id:i.requestId,order_ref:i.orderRef,tracking_sha256:i.trackingSha256,
       customer_name:i.name,customer_phone:i.phone,status:'pending_review',telegram_message_id:null};
      reviewDb.set(i.requestId,row);rows=[row];
     }break;
    case 'review.set_telegram':{
     const row=reviewDb.get(i.requestId);
     if(row&&row.status==='pending_review'&&row.telegram_message_id===null){row.telegram_message_id=i.messageId;rows=[row];}
     break;}
    case 'review.decide':{
     const row=reviewDb.get(i.requestId);
     if(row&&row.status==='pending_review'&&
       (i.status==='delivery_uncertain'||row.telegram_message_id===i.messageId)){
       Object.assign(row,{status:i.status,rejection_reason:i.reason,reviewed_by:i.actorId});rows=[row];
     }break;}
    default:assert.fail('unexpected action '+payload.action);
   }
   return {ok:true,json:async()=>({rows})};
  };
  const ledger=initLedger(),review=initReviewStore();
  const id=randomUUID(),orderRef=id.replace(/-/g,'').slice(0,8),digest2='f'.repeat(64),token=trackingToken();
  assert.equal(await ledger.lookup(id),null);
  assert.equal(await ledger.claim({requestId:id,digest:digest2,orderRef}),true);
  assert.equal(await ledger.claim({requestId:id,digest:digest2,orderRef}),false);
  const row=await review.create({requestId:id,orderRef,token,name:'Cliente Fictício',
   phone:'51999999999',items:[{product:'Baguete Frango',cents:2500,quantity:1}],
   fulfillment:{type:'pickup'},payment:{method:'pix'},subtotal:2500,fee:null});
  assert.equal(row.tracking_sha256,tokenDigest(token));
  assert.equal((await review.get(id)).status,'pending_review');
  await review.setTelegram(id,111);
  await assert.rejects(()=>review.setTelegram(id,111));
  await ledger.finish(id,'delivered',111);
  const decision=await review.decide(id,'rejected',123456,'Produto indisponível',111);
  assert.equal(decision.status,'rejected');
  assert.equal(decision.rejection_reason,'Produto indisponível');
  assert.equal(await review.decide(id,'approved',123456,null,111),null,'decision must be terminal');
  const opening=await loadStoreStatus();
  assert.equal(opening.enabled,true);
  assert.equal(opening.open,true);
  assert.ok(operations.includes('ledger.claim'));
  assert.ok(operations.includes('review.decide'));
  assert.ok(operations.includes('store.get'));
  delete process.env.FOOD_GATEWAY_PRIVATE_KEY_B64;
  assert.throws(()=>initLedger(),Error,'missing signer must fail closed');
  assert.throws(()=>initReviewStore(),Error,'missing signer must fail closed');
  await assert.rejects(()=>loadStoreStatus(),Error);
  console.log('PASS: Ed25519 verified, non-global shared routing, ledger idempotency, review, decisions, store hours and fail-closed.');
 }finally{
  global.fetch=originalFetch;
  for(const k of ['FOOD_DB_TOPOLOGY','SUPABASE_URL','FOOD_GATEWAY_URL',
    'FOOD_GATEWAY_PRIVATE_KEY_B64','SUPABASE_SECRET_KEY',
    'ORDER_LEDGER_MODE','ORDER_APPROVAL_MODE','STORE_HOURS_MODE']){
   if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];
  }
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
