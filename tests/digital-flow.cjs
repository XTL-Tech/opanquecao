'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const db=require('../lib/backoffice-neon'),auth=require('../lib/customer-auth'),accounts=require('../lib/customer-accounts');
const approval=require('../lib/telegram-approval');
const handler=require('../api/whatsapp-intent'),legacy=require('../api/order');
const catalog=require('../cardapio.json');
Object.assign(process.env,{DIGITAL_ORDERS_ENABLED:'true',DELIVERY_ACCOUNT_REQUIRED:'true',VERCEL_ENV:'production',STORE_HOURS_MODE:'required',STORE_HOURS_SOURCE:'neon',CATALOG_SOURCE:'neon',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'fake',TURNSTILE_SECRET_KEY:'fake'});
const saved=new Map();let open=true,telegramOk=true,authorized=true,notifications=0;
db.configured=()=>true;
db.getCatalog=async()=>({catalog,revision:1});
db.run=async(sql,params)=>{
 if(sql.includes('dp.store_operations'))return [{restaurant_id:'opanquecao',time_zone:'America/Sao_Paulo',accepting_orders:open,enforce_opening_hours:true,weekly_schedule:{},holiday_exceptions:{},manual_state:'open',manual_override_until:new Date(Date.now()+600000).toISOString()}];
 if(sql.startsWith('INSERT INTO dp.customers'))return [{id:sql.includes('account_subject')?'00000000-0000-4000-8000-000000000002':params[0],name:'Cliente fictício',phone:null}];
 throw Error('Unexpected SQL: '+sql);
};
db.upsertCustomer=async()=>{throw Error('No legacy phone merge for registered or guest account')};
db.createOrder=async d=>{
 assert.equal(d.status,'awaiting_acceptance');assert.equal(d.items[0].cents,1000);
 const old=saved.get(d.requestId);if(old)return{created:false,record:old.record};
 const row={data:d,record:{request_id:d.requestId,telegram_state:'pending',delivery_fee_cents:d.deliveryFeeCents}};
 saved.set(d.requestId,row);return{created:true,record:row.record};
};
db.patchOrder=async(id,where,patch)=>Object.assign(saved.get(id).record,patch);
auth.config=()=>({});auth.originGuard=()=>{};
auth.actor=async()=>{if(!authorized)throw new auth.AccountError('Entre na sua conta.',401);return {subject:'test-subject'}};
accounts.profile=async()=>({name:'Cliente fictício',phone:'51999999999',hasCpf:true});
approval.approvalEnabled=()=>true;
global.fetch=async(url,opts)=>{
 if(url.endsWith('/siteverify'))return {ok:true,json:async()=>({success:true,action:'order_intent',hostname:'example.test'})};
 if(url.endsWith('/sendMessage')){
  notifications++;const b=JSON.parse(opts.body);assert.match(b.text,/NOVO PEDIDO/);assert.equal(b.reply_markup.inline_keyboard[0].length,2);return{ok:telegramOk,json:async()=>({ok:telegramOk})};
 }
 throw Error('Unexpected network');
};
const item={category:'bebidas',product:'Coca-Cola Lata',option:'Único',quantity:1,note:'',flavors:[],freeExtras:[],paidExtras:[],cents:1};
const payload=(type='table',city='Nova Hartz')=>({requestId:randomUUID(),name:'Cliente fictício',phone:type==='table'?'':'51999999999',challenge:'fake',lines:[item],note:'',fulfillment:type==='table'?{type,table:'4'}:{type,city,neighborhood:city==='Nova Hartz'?'Centro':'__other__',otherNeighborhood:'Bairro de teste',street:'Rua Teste',number:'1'},deliveryFeeCents:1});
async function call(body,fn=handler){
 const r={code:0,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await fn({method:'POST',headers:{host:'example.test',origin:'https://example.test'},body},r);return r;
}
(async()=>{
 let p=payload(),r=await call(p);assert.equal(r.code,201);assert.equal(r.body.digital,true);assert.equal(r.body.deliveryFeeCents,null);assert.equal(saved.get(p.requestId).data.accountSubject,null);
 await call(p);assert.equal(notifications,1);
 p=payload('delivery');r=await call(p);assert.equal(r.code,201);assert.equal(r.body.deliveryFeeCents,1000);assert.equal(saved.get(p.requestId).data.accountSubject,'test-subject');
 p=payload('delivery','Parobé');r=await call(p);assert.equal(r.code,201);assert.equal(r.body.deliveryFeeCents,3500);assert.equal(r.body.prepaidPix,true);
 authorized=false;r=await call(payload('delivery'));assert.equal(r.code,401);authorized=true;
 open=false;r=await call(payload());assert.equal(r.code,423);open=true;
 telegramOk=false;p=payload();r=await call(p);assert.equal(r.code,201);assert.equal(r.body.telegramConfirmed,false);assert.equal(saved.get(p.requestId).record.telegram_state,'uncertain');
 telegramOk=true;const before=notifications;await call(p);assert.equal(notifications,before);
 r=await call(payload(),legacy);assert.equal(r.code,410);
 process.env.VERCEL_ENV='preview';r=await call(payload());assert.equal(r.code,503);assert.equal(notifications,before);
 console.log('PASS: digital order API — table, CPF delivery, R$10/R$35 server tariffs, replay, closed, Telegram fallback and preview isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
