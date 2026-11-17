'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const handler=require('../api/order');
function response(){return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(j){this.body=j;return this}}}
(async()=>{
 const {orderOptions}=await import('../order-catalog.mjs');
 const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
 const category=catalog.categorias.find(c=>c.itens.some(i=>orderOptions(i).length));
 const item=category.itens.find(i=>orderOptions(i).length);
 const line={category:category.id,product:item.nome,option:orderOptions(item)[0].label,
  quantity:1,note:'',freeExtras:[],paidExtras:[]};
 Object.assign(process.env,{
  ORDER_APPROVAL_MODE:'required',ORDER_LEDGER_MODE:'required',
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake',
  TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'-1005555555555',TURNSTILE_SECRET_KEY:'fake',
  TELEGRAM_WEBHOOK_SECRET:'fake-webhook',TELEGRAM_REVIEWER_IDS:'123456',VERCEL_ENV:'preview',CATALOG_SOURCE:'file'
 });
 delete process.env.STORE_HOURS_MODE;
 const ledger=new Map(),review=new Map(),calls=[];
 let telegramOkay=true;
 global.fetch=async(url,options={})=>{
  const u=new URL(url),method=options.method||'GET';
  if(url.includes('/siteverify')){calls.push('turnstile');return {ok:true,json:async()=>({success:true})};}
  if(url.includes('/sendDocument')){
   calls.push('telegram');
   const markup=JSON.parse(options.body.get('reply_markup'));
   assert.equal(markup.inline_keyboard[0].length,2,'Telegram approve/reject keyboard');
   assert.equal(markup.inline_keyboard[0][0].text,'Aprovar pedido');
   return {ok:telegramOkay,status:telegramOkay?200:502,json:async()=>({ok:telegramOkay,result:{message_id:312}})};
  }
  if(url.includes('/restaurant_order_intents')){
   const id=u.searchParams.get('request_id')?.slice(3);
   if(method==='GET')return {ok:true,json:async()=>ledger.has(id)?[ledger.get(id)]:[]};
   if(method==='POST'){
    calls.push('ledger_claim');const row=JSON.parse(options.body);
    if(ledger.has(row.request_id))return {ok:true,json:async()=>[]};
    ledger.set(row.request_id,row);return {ok:true,json:async()=>[row]};
   }
   if(method==='PATCH'){
    calls.push('ledger_finish');const row=ledger.get(id);
    if(!row||row.status!=='processing')return {ok:true,json:async()=>[]};
    Object.assign(row,JSON.parse(options.body));return {ok:true,json:async()=>[row]};
   }
  }
  if(url.includes('/restaurant_preorder_reviews')){
   const id=u.searchParams.get('request_id')?.slice(3);
   if(method==='GET')return {ok:true,json:async()=>review.has(id)?[review.get(id)]:[]};
   if(method==='POST'){
    calls.push('review_create');const row=JSON.parse(options.body);
    if(review.has(row.request_id))return {ok:true,json:async()=>[]};
    review.set(row.request_id,row);return {ok:true,json:async()=>[row]};
   }
   if(method==='PATCH'){
    calls.push('review_update');const row=review.get(id);
    if(!row||row.status!==u.searchParams.get('status')?.slice(3))return {ok:true,json:async()=>[]};
    Object.assign(row,JSON.parse(options.body));return {ok:true,json:async()=>[row]};
   }
  }
  throw Error('Unexpected network '+url);
 };
 const submit=async requestId=>{
  const req={method:'POST',headers:{},body:{
   requestId,name:'Cliente fictício',phone:'51999999999',challenge:'token-test',
   lines:[line],payment:{method:'pix',changeForCents:null},
   fulfillment:{type:'pickup',address:'',table:'',latitude:null,longitude:null}
  }};
  const res=response();await handler(req,res);return res;
 };
 let id=randomUUID();
 let result=await submit(id);
 assert.equal(result.statusCode,200,JSON.stringify(result.body));
 assert.equal(result.body.reviewPending,true);
 assert.equal(result.body.requestId,id);
 assert.match(result.body.trackingToken,/^[A-Za-z0-9_-]{43}$/);
 assert.ok(calls.indexOf('review_create')<calls.indexOf('telegram'),'Persist must happen before Telegram delivery');
 assert.equal(review.get(id).status,'pending_review');
 assert.equal(review.get(id).telegram_message_id,312);
 result=await submit(id);
 assert.equal(result.statusCode,200);
 assert.equal(result.body.replayed,true);
 assert.equal(calls.filter(c=>c==='telegram').length,1,'Idempotency must prevent duplicate Telegram');
 const before=calls.filter(c=>c==='telegram').length;
 telegramOkay=false;
 id=randomUUID();result=await submit(id);
 assert.equal(result.statusCode,202);
 assert.equal(result.body.pending,true);
 assert.equal(result.body.reviewPending,true);
 assert.equal(review.get(id).status,'delivery_uncertain');
 assert.equal(ledger.get(id).status,'needs_review');
 result=await submit(id);
 assert.equal(result.statusCode,202);
 assert.equal(calls.filter(c=>c==='telegram').length,before+1,'No retry after uncertain Telegram result');
 telegramOkay=true;
 const old=process.env.ORDER_LEDGER_MODE;delete process.env.ORDER_LEDGER_MODE;
 result=await submit(randomUUID());
 assert.equal(result.statusCode,503,'Review requires ledger; never send without durable DB');
 process.env.ORDER_LEDGER_MODE=old;
 console.log('PASS: order persistence before Telegram, approve/reject keyboard, private token, retry suppression, uncertain delivery');
})().catch(e=>{console.error(e);process.exitCode=1});
