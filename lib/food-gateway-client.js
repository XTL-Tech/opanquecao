'use strict';
// Backend-only signed transport to XTL Food gateway: no global Supabase secret in Vercel.
// FOOD_GATEWAY_PRIVATE_KEY_B64 is PKCS8 DER Ed25519; never exposed to the browser.
const {createHash,createPrivateKey,sign,randomBytes}=require('node:crypto');
const {isSharedFoodDatabase,SHARED_XTL_REF}=require('./food-db-policy');
class FoodGatewayUnavailable extends Error {
  constructor(){super('Gateway XTL Food indisponível ou não configurado');this.name='FoodGatewayUnavailable';}
}
const ACTIONS=new Set(['ledger.lookup','ledger.claim','ledger.finish',
  'review.get','review.create','review.set_telegram','review.decide','store.get']);
function gatewayEndpoint(env=process.env){
  if(!isSharedFoodDatabase(env))throw new FoodGatewayUnavailable();
  // Never silently accept a global Supabase secret even when the signed gateway works.
  if(typeof env.SUPABASE_SECRET_KEY==='string' && env.SUPABASE_SECRET_KEY.trim())
    throw new FoodGatewayUnavailable();
  const url=env.FOOD_GATEWAY_URL;
  if(typeof url!=='string')throw new FoodGatewayUnavailable();
  let u;try{u=new URL(url);}catch{throw new FoodGatewayUnavailable();}
  if(u.protocol!=='https:'||u.hostname!==SHARED_XTL_REF+'.supabase.co'||
     u.pathname!=='/functions/v1/xtl-food-gateway'||u.search||u.hash||u.username||u.password)
    throw new FoodGatewayUnavailable();
  return u.toString();
}
function signedRequest(action,input,env=process.env,now=Date.now()){
  const url=gatewayEndpoint(env);
  if(!ACTIONS.has(action)||typeof input!=='object'||!input||Array.isArray(input))throw new FoodGatewayUnavailable();
  const encoded=env.FOOD_GATEWAY_PRIVATE_KEY_B64;
  if(typeof encoded!=='string'||!/^[A-Za-z0-9+/=]{48,}$/.test(encoded))throw new FoodGatewayUnavailable();
  let key;
  try{key=createPrivateKey({key:Buffer.from(encoded,'base64'),format:'der',type:'pkcs8'});}
  catch{throw new FoodGatewayUnavailable();}
  if(key.asymmetricKeyType!=='ed25519')throw new FoodGatewayUnavailable();
  const body=JSON.stringify({action,input});
  if(Buffer.byteLength(body,'utf8')>50000)throw new FoodGatewayUnavailable();
  const stamp=String(now);
  const digest=createHash('sha256').update(body).digest('hex');
  const nonce=randomBytes(16).toString('base64url');
  const signature=sign(null,Buffer.from(stamp+'\nPOST\n/xtl-food-gateway\n'+nonce+'\n'+digest),key).toString('base64url');
  return {url,body,headers:{'content-type':'application/json',
    'x-xtl-food-time':stamp,'x-xtl-food-nonce':nonce,'x-xtl-food-signature':signature}};
}
async function callFoodGateway(action,input){
  const request=signedRequest(action,input);
  let result;
  try{
    result=await fetch(request.url,{method:'POST',headers:request.headers,body:request.body,
      cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!result.ok)throw new Error('gateway_http_failure');
    const json=await result.json();
    if(!Array.isArray(json?.rows))throw new Error('gateway_bad_response');
    return json.rows;
  }catch{throw new FoodGatewayUnavailable();}
}
module.exports={FoodGatewayUnavailable,gatewayEndpoint,signedRequest,callFoodGateway};
