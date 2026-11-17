'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const review=require('../lib/order-review');
const statusApi=require('../api/order-status');
const webhook=require('../api/telegram-review');
const bot=require('../lib/telegram-review');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/202611170005_preorder_reviews.sql','utf8');
function response(){return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(j){this.body=j;return this}}}
async function call(handler,req){const res=response();await handler(req,res);return res;}
(async()=>{
 delete process.env.ORDER_APPROVAL_MODE;
 let x=await call(statusApi,{method:'POST',body:{}});assert.equal(x.statusCode,404);
 x=await call(webhook,{method:'POST',headers:{},body:{}});assert.equal(x.statusCode,404);
 Object.assign(process.env,{
  ORDER_APPROVAL_MODE:'required',ORDER_LEDGER_MODE:'required',
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake-only-test',
  TELEGRAM_BOT_TOKEN:'fake-bot-test',TELEGRAM_CHAT_ID:'-1009876543210',
  TELEGRAM_WEBHOOK_SECRET:'fake-webhook-secret',TELEGRAM_REVIEWER_IDS:'123456'
 });
 const db=new Map(),history=[];
 global.fetch=async(url,init={})=>{
  if(url.includes('/restaurant_preorder_reviews')){
   const u=new URL(url),method=init.method||'GET',id=u.searchParams.get('request_id')?.slice(3);
   if(method==='GET')return {ok:true,json:async()=>db.has(id)?[db.get(id)]:[]};
   if(method==='POST'){
    const row=JSON.parse(init.body);
    if(db.has(row.request_id))return {ok:true,json:async()=>[]};
    db.set(row.request_id,row);return {ok:true,json:async()=>[row]};
   }
   if(method==='PATCH'){
    const row=db.get(id),statusFilter=u.searchParams.get('status')?.slice(3);
    const telegramId=u.searchParams.get('telegram_message_id')?.slice(3);
    if(!row||row.status!==statusFilter||(telegramId&&row.telegram_message_id!==Number(telegramId)))
     return {ok:true,json:async()=>[]};
    Object.assign(row,JSON.parse(init.body));return {ok:true,json:async()=>[row]};
   }
   throw Error('bad method');
  }
  if(url.includes('/botfake-bot-test/')){
   const action=url.split('/').at(-1),body=JSON.parse(init.body);history.push({action,body});
   return {ok:true,json:async()=>({ok:true,result:true})};
  }
  throw Error('Unexpected network call: '+url);
 };
 const id=randomUUID(),tok=review.trackingToken(),store=review.initReviewStore();
 assert.equal(tok.length,43);
 assert.equal(review.tokenMatches(tok,review.tokenDigest(tok)),true);
 assert.equal(review.tokenMatches(review.trackingToken(),review.tokenDigest(tok)),false);
 assert.equal(bot.parseCallback('a:'+id).action,'a');
 assert.equal(bot.parseCallback('x:p:'+id).reason,'Produto indisponível');
 assert.equal(bot.parseCallback('a:invalid'),null);
 assert.ok(bot.whatsappUrl===undefined,'Only the approved control exposes WhatsApp template');
 const rowData={requestId:id,orderRef:id.replace(/-/g,'').slice(0,8),token:tok,
  name:'Cliente demonstração',phone:'51999999999',items:[],fulfillment:{type:'pickup'},payment:{method:'pix'},subtotal:2500,fee:null};
 await store.create(rowData);
 await assert.rejects(()=>store.create(rowData),review.ReviewUnavailable);
 await store.setTelegram(id,99);
 const tokenReq=(requestId,token)=>({method:'POST',body:{requestId,token}});
 x=await call(statusApi,tokenReq(id,'wrong-token'));assert.equal(x.statusCode,404);
 x=await call(statusApi,tokenReq(id,review.trackingToken()));assert.equal(x.statusCode,404);
 x=await call(statusApi,tokenReq(id,tok));
 assert.equal(x.statusCode,200);assert.equal(x.body.status,'pending_review');
 assert.equal(x.body.id,rowData.orderRef);assert.equal(x.body.customer_phone,undefined);
 const callback=(data,actor=123456,secret='fake-webhook-secret',chatId=-1009876543210,messageId=99)=>({
  method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
  body:{callback_query:{id:'cb1',data,from:{id:actor},message:{chat:{id:chatId},message_id:messageId}}}
 });
 x=await call(webhook,callback('r:'+id,123456,'wrong'));
 assert.equal(x.statusCode,403);assert.equal(db.get(id).status,'pending_review');
 x=await call(webhook,callback('a:'+id,101));
 assert.equal(x.statusCode,200);assert.equal(db.get(id).status,'pending_review');
 x=await call(webhook,callback('a:'+id,123456,'fake-webhook-secret',-1009876543211));
 assert.equal(x.statusCode,200);assert.equal(db.get(id).status,'pending_review');
 x=await call(webhook,callback('a:'+id,123456,'fake-webhook-secret',-1009876543210,100));
 assert.equal(x.statusCode,200);assert.equal(db.get(id).status,'pending_review');
 x=await call(webhook,callback('r:'+id));assert.equal(x.statusCode,200);
 assert.equal(db.get(id).status,'pending_review');
 assert.equal(history.filter(h=>h.action==='editMessageReplyMarkup').at(-1).body.reply_markup.inline_keyboard.length,6);
 x=await call(webhook,callback('x:p:'+id));assert.equal(x.statusCode,200);
 assert.equal(db.get(id).status,'rejected');
 x=await call(statusApi,tokenReq(id,tok));
 assert.equal(x.body.status,'rejected');assert.equal(x.body.reason,'Produto indisponível');
 x=await call(webhook,callback('a:'+id));assert.equal(db.get(id).status,'rejected','Rejection cannot be overwritten');
 const id2=randomUUID(),tok2=review.trackingToken();
 await store.create({...rowData,requestId:id2,orderRef:id2.replace(/-/g,'').slice(0,8),token:tok2});
 await store.setTelegram(id2,101);
 x=await call(webhook,callback('a:'+id2,123456,'fake-webhook-secret',-1009876543210,101));
 assert.equal(x.statusCode,200);assert.equal(db.get(id2).status,'approved');
 const edit=history.filter(h=>h.action==='editMessageReplyMarkup').at(-1);
 assert.match(edit.body.reply_markup.inline_keyboard[0][0].url,/^https:\/\/wa.me\/5551999999999\?text=/);
 assert.match(decodeURIComponent(edit.body.reply_markup.inline_keyboard[0][0].url),/Seu pré-pedido/);
 assert.equal(history.filter(h=>h.action==='sendMessage').length,1,'Only rejection notification goes to store, not client automatically');
 x=await call(statusApi,tokenReq(id2,tok2));assert.equal(x.body.status,'approved');assert.equal(x.body.reason,null);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/i);
 assert.match(migration,/REVOKE ALL.*anon, authenticated/i);
 assert.match(migration,/UNIQUE \(restaurant_id, order_ref\)/i);
 assert.match(migration,/status.*pending_review/i);
 const current=fs.readFileSync('api/order.js','utf8');
 assert.match(current,/await reviewStore.create/);
 assert.ok(current.indexOf('await reviewStore.create')<current.indexOf('sendDocument'),'Review must persist before Telegram');
 assert.match(current,/form\.set\('reply_markup'/);
 const client=fs.readFileSync('order-review-client.mjs','utf8');
 assert.match(client,/sessionStorage/);
 assert.match(client,/\/api\/order-status/);
 assert.doesNotMatch(client,/\?token=/);
 console.log('PASS: private status, consent-gated link, Telegram auth, rejection with reason, approval, race protection, RLS and feature flags');
})().catch(e=>{console.error(e);process.exitCode=1});
