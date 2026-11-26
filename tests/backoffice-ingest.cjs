'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const db=require('../lib/backoffice-neon');
const handler=require('../api/whatsapp-intent');
const example='11111111-1111-4111-8111-111111111111';
const record={customer:{id:example}};
const status=new Map();
let texts=0,docs=0,documentOk=true,dbOk=true;
Object.assign(process.env,{
 VERCEL_ENV:'production',BACKOFFICE_ENABLED:'true',
 TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'fake',TURNSTILE_SECRET_KEY:'fake'
});
db.configured=()=>true;
db.upsertCustomer=async data=>{
 assert.equal(data.phone,'51999999999');
 if(!dbOk)throw Error('bank unavailable');
 return {id:example,...data};
};
db.createOrder=async data=>{
 assert.equal(data.items[0].cents,1000,'Preço calculado pelo servidor');
 if(!dbOk)throw Error('bank unavailable');
 const old=status.get(data.requestId);
 if(old)return{record:old,created:false};
 const o={request_id:data.requestId,telegram_state:'pending'};
 status.set(data.requestId,o);return{record:o,created:true};
};
db.patchOrder=async(id,filter,update)=>{
 const o=status.get(id);assert.ok(o);
 assert.equal(o.telegram_state,'pending');
 assert.equal(filter.telegram_state,'eq.pending');
 Object.assign(o,update);
 return o;
};
global.fetch=async(url,opts)=>{
 if(String(url).endsWith('/siteverify'))return{ok:true,json:async()=>({success:true,action:'order_intent',hostname:'opanquecao.vercel.app'})};
 if(String(url).endsWith('/sendMessage')){texts++;return{ok:true,json:async()=>({ok:true,result:{message_id:201}})};}
 if(String(url).endsWith('/sendDocument')){docs++;assert.equal(opts.body.get('caption'),'🔔 NOVO PEDIDO\nAguardando confirmação pelo WhatsApp.');assert.match(JSON.parse(opts.body.get('reply_markup')).inline_keyboard[0][0].url,/^https:\/\/wa\.me\/5551999999999\?text=/);return{ok:documentOk,json:async()=>({ok:documentOk,result:{message_id:202}})};}
 throw Error('Unauthorized network: '+url);
};
const payload=id=>({requestId:id,name:'Cliente Exemplo',phone:'(51) 99999-9999',
 lines:[{category:'bebidas',product:'Coca-Cola Lata',option:'Único',quantity:1,note:'',flavors:[],freeExtras:[],paidExtras:[],cents:1}],
 fulfillment:{type:'pickup'},note:'',challenge:'fake'});
const request=async body=>{
 const res={code:0,setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};
 await handler({method:'POST',headers:{host:'opanquecao.vercel.app'},body},res);return res;
};
(async()=>{
 const id=randomUUID();
 let r=await request(payload(id));
 assert.equal(r.code,201);assert.equal(r.body.status,'registered');
 assert.equal(texts,0);assert.equal(docs,1);
 assert.equal(status.get(id).telegram_state,'sent');
 r=await request(payload(id));
 assert.equal(r.code,201);assert.equal(r.body.replayed,true);
 assert.equal(texts,0,'Não enviar texto separado');
 assert.equal(docs,1,'Replay não envia outro cupom');
 const next=randomUUID();documentOk=false;
 r=await request(payload(next));
 assert.equal(r.code,202);
 assert.equal(status.get(next).telegram_state,'uncertain');
 const textAfter=texts,docAfter=docs;
 documentOk=true;r=await request(payload(next));
 assert.equal(r.code,202);
 assert.equal(texts,textAfter);assert.equal(docs,docAfter);
 dbOk=false;
 r=await request(payload(randomUUID()));
 assert.equal(r.code,503);
 assert.equal(texts,textAfter);assert.equal(docs,docAfter);
 console.log('PASS BO INTAKE: pré-pedido persistido antes do bot, replay idempotente, falha parcial incerta e banco indisponível bloqueia envio.');
})().catch(err=>{console.error(err);process.exitCode=1});
