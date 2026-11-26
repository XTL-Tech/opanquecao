'use strict';
const assert=require('node:assert/strict');
const db=require('../lib/backoffice-neon');
const {handler,approvalEnabled}=require('../lib/telegram-approval');
const id='11111111-1111-4111-8111-111111111111';
const actor='22222222-2222-4222-8222-222222222222';
Object.assign(process.env,{VERCEL_ENV:'production',TELEGRAM_APPROVAL_ENABLED:'true',
 TELEGRAM_APPROVAL_WEBHOOK_SECRET:'a'.repeat(40),TELEGRAM_CHAT_ID:'-100123',
 TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_APPROVAL_USERS:JSON.stringify({'123':actor})});
db.configured=()=>true;
let status='pending_customer',fee=null,type='pickup',active=true,updates=0;
db.staff=async v=>v===actor?{active,role:'attendant'}:null;
db.getOrder=async()=>({status,delivery_fee_cents:fee,fulfillment:{type}});
db.run=async(sql,params)=>{
 assert.match(sql,/status IN \('pending_customer','awaiting_acceptance'\)/);
 assert.match(sql,/delivery_fee_cents IS NOT NULL/);
 assert.match(sql,/telegram_state='sent'/);
 assert.match(sql,/EXISTS\(SELECT 1 FROM dp.staff/);
 assert.deepEqual(params,[id,actor]);
 if(!active||!['pending_customer','awaiting_acceptance'].includes(status)||(type==='delivery'&&fee===null))return [];
 status='accepted';updates++;return[{request_id:id,status}];
};
const calls=[];
global.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return{ok:true,json:async()=>({ok:true})};};
const run=async({user=123,chat=-100123,secret='a'.repeat(40),data='accept:'+id}={})=>{
 const res={code:0,setHeader(){},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{callback_query:{
 id:'callback',data,from:{id:user},message:{message_id:10,chat:{id:chat},reply_markup:{inline_keyboard:[[{url:'https://wa.me/5551999999999?text=oi'}]]}}
 }}},res);return res;
};
(async()=>{
 assert.equal(approvalEnabled(),true);
 assert.equal((await run({secret:'wrong'})).code,403);assert.equal(updates,0);
 assert.equal((await run({user:999})).code,200);assert.equal(updates,0);
 assert.equal((await run({chat:-100999})).code,200);assert.equal(updates,0);
 active=false;await run();assert.equal(updates,0);active=true;
 type='delivery';await run();assert.equal(updates,0);
 fee=700;await run();assert.equal(status,'accepted');assert.equal(updates,1);
 const edit=calls.find(c=>c.url.endsWith('/editMessageCaption'));
 assert.match(edit.body.caption,/PEDIDO ACEITO/);assert.equal(edit.body.reply_markup.inline_keyboard[0][0].url,'https://wa.me/5551999999999?text=oi');
 await run();assert.equal(updates,1);
 status='cancelled';await run();assert.equal(updates,1);
 process.env.VERCEL_ENV='preview';assert.equal(approvalEnabled(),false);assert.equal((await run()).code,503);
 console.log('PASS Telegram approval: webhook secret, staff allowlist, chat, fee, atomic acceptance and replay.');
})().catch(e=>{console.error(e);process.exitCode=1;});
