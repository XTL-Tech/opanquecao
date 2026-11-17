'use strict';
const assert=require('node:assert/strict');
const handler=require('../api/store-status');
const {loadStoreStatus,StoreStatusUnavailable}=require('../lib/store-hours-source');
function res() {return {code:null,headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.body=v;return this}}}
(async()=>{
  delete process.env.STORE_HOURS_MODE;
  const legacy=res();
  await handler({method:'GET'},legacy);
  assert.equal(legacy.code,200);
  assert.equal(legacy.body.enabled,false);
  process.env.STORE_HOURS_MODE='required';
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY='fake';
  const row={restaurant_id:'opanquecao',time_zone:'America/Sao_Paulo',accepting_orders:true,
    enforce_opening_hours:false,weekly_schedule:{},holiday_exceptions:{},
    manual_state:'closed',manual_override_until:'2999-01-01T00:00:00Z'};
  let hits=0;
  global.fetch=async()=>{hits++;return {ok:true,json:async()=>[row]}};
  const closed=res();
  await handler({method:'GET'},closed);
  assert.equal(closed.code,200);
  assert.equal(closed.body.open,false);
  assert.equal(closed.body.reason,'manual_closed');
  assert.equal(closed.body.canSubscribe,false);
  assert.equal(hits,1);
  row.manual_state='open';
  const open=res();
  await handler({method:'GET'},open);
  assert.equal(open.code,200);
  assert.equal(open.body.open,true);
  global.fetch=async()=>{throw new Error('network disconnected')};
  await assert.rejects(()=>loadStoreStatus(),StoreStatusUnavailable);
  const unavailable=res();
  await handler({method:'GET'},unavailable);
  assert.equal(unavailable.code,503);
  assert.equal(unavailable.body.open,false);
  assert.equal(unavailable.body.unknown,true);
  const wrongMethod=res();
  await handler({method:'POST'},wrongMethod);
  assert.equal(wrongMethod.code,405);
  console.log('PASS: store status API, manual override, missing DB and fail-closed');
})().catch(error=>{console.error(error);process.exitCode=1});
