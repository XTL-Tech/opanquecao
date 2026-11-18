'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {generateKeyPairSync,webcrypto}=require('node:crypto');
const {signedRequest,SHARED_XTL_REF}=(()=>{
  const a=require('../lib/food-gateway-client');
  const b=require('../lib/food-db-policy');
  return {...a,...b};
})();
(async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const env={
    FOOD_DB_TOPOLOGY:'shared',
    SUPABASE_URL:'https://'+SHARED_XTL_REF+'.supabase.co',
    FOOD_GATEWAY_URL:'https://'+SHARED_XTL_REF+'.supabase.co/functions/v1/xtl-food-gateway',
    FOOD_GATEWAY_PRIVATE_KEY_B64:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')
  };
  const settings={
    FOOD_GATEWAY_PUBLIC_KEY_B64:publicKey.export({format:'der',type:'spki'}).toString('base64'),
    SUPABASE_URL:env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:'not-a-real-key'
  };
  const nonces=new Set();
  const databaseCalls=[];
  let failNonce=false;
  const mockFetch=async(url,init)=>{
    if(url.includes('/xtl_food_gateway_nonces?')){
      if(failNonce)return new Response(JSON.stringify({error:'unavailable'}),{status:503});
      assert.equal(init.method,'POST');
      const row=JSON.parse(init.body);
      assert.match(row.nonce_sha256,/^[0-9a-f]{64}$/);
      assert.equal(row.restaurant_id,'opanquecao');
      const inserted=!nonces.has(row.nonce_sha256);
      nonces.add(row.nonce_sha256);
      return new Response(JSON.stringify(inserted?[row]:[]),{status:200});
    }
    if(url.includes('/restaurant_operations?')){
      databaseCalls.push(url);
      return new Response(JSON.stringify([{
        restaurant_id:'opanquecao',time_zone:'America/Sao_Paulo',
        accepting_orders:true,enforce_opening_hours:false,weekly_schedule:{},
        holiday_exceptions:{},manual_state:'auto'
      }]),{status:200});
    }
    assert.fail('unexpected database access: '+url);
  };
  let handler;
  const source=fs.readFileSync('supabase/functions/xtl-food-gateway/index.ts','utf8');
  const executable=stripTypeScriptTypes(source,{mode:'strip'});
  const context={
    Deno:{env:{get:key=>settings[key]},serve:fn=>{handler=fn;}},
    crypto:webcrypto,TextEncoder,atob,fetch:mockFetch,AbortSignal,
    Response,Request,URL,Uint8Array,Date,console,JSON,Array,Object,
    Number,String,Math,Error,TypeError,RegExp,Set
  };
  vm.runInNewContext(executable,context,{filename:'index.ts',timeout:2000});
  assert.equal(typeof handler,'function');
  const dispatch=async(signed,overrides={})=>{
    const request=new Request(env.FOOD_GATEWAY_URL,{
      method:'POST',
      headers:overrides.headers||signed.headers,
      body:overrides.body||signed.body
    });
    return handler(request);
  };
  const first=signedRequest('store.get',{},env);
  const res=await dispatch(first);
  assert.equal(res.status,200,JSON.stringify(await res.clone().json()));
  const data=await res.json();
  assert.equal(data.rows[0].restaurant_id,'opanquecao');
  assert.equal(databaseCalls.length,1);
  assert.equal(nonces.size,1);

  const replay=await dispatch(first);
  assert.equal(replay.status,409,'same signed request must be blocked');
  assert.equal((await replay.json()).error,'request_already_used');
  assert.equal(databaseCalls.length,1,'replay did not reach operational tables');
  assert.equal(nonces.size,1);

  const second=signedRequest('store.get',{},env);
  assert.notEqual(first.headers['x-xtl-food-nonce'],second.headers['x-xtl-food-nonce']);
  assert.equal((await dispatch(second)).status,200);
  assert.equal(databaseCalls.length,2);

  const changedNonce={...first.headers,'x-xtl-food-nonce':second.headers['x-xtl-food-nonce']};
  assert.equal((await dispatch(first,{headers:changedNonce})).status,401,'nonce is signed');
  assert.equal(databaseCalls.length,2);

  const changedBody=JSON.stringify({action:'store.get',input:{forbidden:true}});
  assert.equal((await dispatch(first,{body:changedBody})).status,401,'body is signed');
  assert.equal(databaseCalls.length,2);

  const expired=signedRequest('store.get',{},env,Date.now()-50000);
  assert.equal((await dispatch(expired)).status,401,'expired signature must be rejected');

  assert.throws(()=>signedRequest('xtl_people',{},env),'client rejects unknown tables');
  failNonce=true;
  const fresh=signedRequest('store.get',{},env);
  assert.equal((await dispatch(fresh)).status,503,'nonce storage failure must fail closed');
  assert.equal(databaseCalls.length,2,'database operation not performed after nonce failure');
  failNonce=false;
  const noKey=settings.FOOD_GATEWAY_PUBLIC_KEY_B64;
  delete settings.FOOD_GATEWAY_PUBLIC_KEY_B64;
  assert.equal((await dispatch(signedRequest('store.get',{},env))).status,503,'unconfigured key fails closed');
  settings.FOOD_GATEWAY_PUBLIC_KEY_B64=noKey;
  assert.equal(nonces.size,2,'only successful requests consume nonces');
  console.log('PASS: real Edge handler enforces Ed25519, nonce uniqueness, tamper rejection, expiry, 503 and action allowlist');
})().catch(e=>{console.error(e);process.exitCode=1});
