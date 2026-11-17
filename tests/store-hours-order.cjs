'use strict';
const assert=require('node:assert/strict');
const handler=require('../api/order');
function res(){return {code:null,setHeader(){},status(c){this.code=c;return this},json(body){this.body=body;return this}}}
(async()=>{
  Object.assign(process.env,{
    STORE_HOURS_MODE:'required',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake',
    TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'fake',TURNSTILE_SECRET_KEY:'fake'
  });
  let called=0;
  global.fetch=async(url)=>{
    called++;
    assert.match(url,/restaurant_operations/,'A chamada deve verificar o expediente antes do Telegram');
    return {ok:true,json:async()=>[{restaurant_id:'opanquecao',time_zone:'America/Sao_Paulo',
      accepting_orders:false,enforce_opening_hours:false,weekly_schedule:{},
      holiday_exceptions:{},manual_state:'auto',manual_override_until:null}]};
  };
  const closed=res();
  await handler({method:'POST',headers:{},body:{}},closed);
  assert.equal(closed.code,423);
  assert.match(closed.body.error,/Loja fechada/);
  assert.equal(called,1,'Não deve acessar Turnstile ou Telegram com loja fechada');
  delete process.env.SUPABASE_SECRET_KEY;
  const unavailable=res();
  await handler({method:'POST',headers:{},body:{}},unavailable);
  assert.equal(unavailable.code,503);
  assert.equal(called,1);
  console.log('PASS: backend rejects closed orders and DB failures before Telegram');
})().catch(error=>{console.error(error);process.exitCode=1});
