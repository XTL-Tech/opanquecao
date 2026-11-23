'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const core=require('../lib/backoffice-core');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const handler=require('../api/backoffice');
const asaas=require('../api/asaas-sandbox');
const webhook=require('../api/asaas-sandbox-webhook');
const {splitSql}=require('../scripts/neon-setup.cjs');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const migration=fs.readFileSync('neon/migrations/001_backoffice.sql','utf8');
const html=fs.readFileSync('backoffice/index.html','utf8');
const frontend=fs.readFileSync('backoffice/app.js','utf8');
assert.match(migration,/create schema if not exists dp/i);
assert.match(migration,/revoke all on schema dp from public/i);
assert.match(migration,/create table if not exists dp\.orders/i);
assert.match(migration,/create table if not exists dp\.asaas_events/i);
assert.match(migration,/pg_advisory_xact_lock/i);
assert.match(migration,/create or replace function dp\.close_cash/i);
assert.ok(splitSql(migration).length>20,'Parser deve preservar funções SQL');
assert.equal(core.statusAllowed('accepted','completed'),true);
assert.equal(core.statusAllowed('delivered','accepted'),false);
assert.equal(core.businessDate().length,10);
const mutated=core.applyPrice(catalog,{category:'panquecas-salgadas',product:'Panquetudo (Especial)',variant:'size:M',priceCents:3500});
assert.equal(mutated.categorias[1].itens.at(-1).tamanhos.M,'R$ 35,00');
assert.equal(catalog.categorias[1].itens.at(-1).tamanhos.M,'R$ 32,00');
const user={id:'user-neon-manager-123',email:'gestor@exemplo.invalid',name:'Gestor de Teste'};
const res=()=>({code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
async function run(fn,method,action,body={},headers={},query={}){
 const r=res();
 await fn({method,body:method==='POST'?{action,...body}:undefined,
  headers,query:{action,...query}},r);
 return r;
}
const goodOrigin={host:'opanquecao.vercel.app',origin:'https://opanquecao.vercel.app'};
const cookie='better-auth.session_token=opaque_fake_session';
(async()=>{
 delete process.env.BACKOFFICE_ENABLED;
 let r=await run(handler,'GET','status');
 assert.equal(r.code,200);assert.equal(r.body.enabled,false);
 r=await run(handler,'GET','dashboard');
 assert.equal(r.code,503);
 r=await run(handler,'POST','login',{email:user.email,password:'senha-ficticia'},
  {...goodOrigin,origin:'https://atacante.invalid'});
 assert.equal(r.code,403);
 Object.assign(process.env,{
  BACKOFFICE_ENABLED:'true',BACKOFFICE_PROVIDER:'neon',
  DATABASE_URL:'postgresql://demo:demo@ep-example.neon.tech/db',
  NEON_AUTH_BASE_URL:'https://ep-example.neonauth.net/db/auth',
  ASAAS_SANDBOX_ENABLED:'true',ASAAS_SANDBOX_API_KEY:'sandbox-test-key',
  ASAAS_SANDBOX_WEBHOOK_TOKEN:'segredo-sandbox-longo-com-mais-de-32-digitos'
 });
 db.staff=async id=>id===user.id?{user_id:id,role:'manager',active:true}:null;
 db.dashboard=async()=>({today:core.businessDate(),orders:[],customers:[],closings:[],
  cash:{orders:0,total_cents:0,cash_cents:0,pix_cents:0,credit_cents:0,debit_cents:0,other_cents:0},catalog:null});
 db.getCatalog=async()=>({catalog,revision:1});
 db.searchCustomers=async()=>[];
 let calls=0,asasaPayload,events=[];
 db.sandboxRecent=async()=>[];
 db.sandboxClaim=async()=>({created:true,record:{id:'123e4567-e89b-42d3-a456-426614174000',
  external_ref:'dp-sandbox-demo-123',amount_cents:500}});
 db.sandboxAttach=async()=>({status:'active'});
 db.sandboxMarkUncertain=async()=>{};
 db.sandboxEvent=async x=>{events.push(x);return{matched:1,inserted:1,updated:1};};
 global.fetch=async(url,opt)=>{
  calls++;
  const link=String(url);
  let data={},headers=new Headers();
  if(link.endsWith('/sign-in/email')){
   assert.equal(opt.method,'POST');data={user,session:{id:'sess'}};
   headers.append('Set-Cookie',cookie+'; Domain=neon.build; Path=/; Secure; HttpOnly; SameSite=Lax');
  }else if(link.endsWith('/get-session')){
   assert.match(opt.headers.Cookie||'',/better-auth\.session_token/);
   data={user,session:{id:'sess'}};
  }else if(link.endsWith('/sign-out'))data={};
  else if(link==='https://api-sandbox.asaas.com/v3/checkouts'){
   assert.equal(opt.headers.access_token,'sandbox-test-key');
   asasaPayload=JSON.parse(opt.body);
   assert.deepEqual(asasaPayload.billingTypes,['PIX','CREDIT_CARD']);
   assert.equal(asasaPayload.items[0].value,5);
   assert.match(asasaPayload.callback.successUrl,/asaas-return/);
   data={id:'ch_sandbox_test_123'};
  }else throw Error('Rede inesperada: '+link);
  return {ok:true,status:200,headers,json:async()=>data};
 };
 r=await run(handler,'POST','login',{email:user.email,password:'senha-ficticia'},goodOrigin);
 assert.equal(r.code,200);assert.equal(r.body.actor.role,'manager');
 assert.ok(r.headers['Set-Cookie']?.[0].includes('HttpOnly'));
 assert.ok(r.headers['Set-Cookie']?.[0].includes('SameSite=Strict'));
 assert.doesNotMatch(r.headers['Set-Cookie'][0],/Domain=/);
 r=await run(handler,'GET','session',{}, {cookie});
 assert.equal(r.code,200);assert.equal(r.body.actor.id,user.id);
 r=await run(handler,'GET','dashboard',{}, {cookie});
 assert.equal(r.code,200);assert.equal(r.body.orders.length,0);
 assert.equal(r.body.catalog,null,'Catálogo é carregado sob demanda');
 r=await run(handler,'GET','catalog',{}, {cookie});
 assert.equal(r.code,200);assert.equal(r.body.catalog.catalog.categorias.length,12);
 r=await run(asaas,'GET','',{}, {cookie});
 assert.equal(r.code,200);assert.equal(r.body.enabled,true);
 r=await run(asaas,'POST','create_sandbox_checkout',{}, {...goodOrigin,cookie});
 assert.equal(r.code,201);assert.equal(r.body.sandbox,true);
 assert.match(r.body.link,/asaas\.com\/checkoutSession/);
 assert.ok(asasaPayload);
 const hook={id:'evt_sandbox_1',event:'CHECKOUT_PAID',
  checkout:{id:'ch_sandbox_test_123',externalReference:'dp-sandbox-demo-123'}};
 r=await run(webhook,'POST','',hook,{'asaas-access-token':'token-errado'});
 assert.equal(r.code,401);
 r=await run(webhook,'POST','',hook,{'asaas-access-token':process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN});
 assert.equal(r.code,200);assert.equal(events.length,1);
 assert.equal(events[0].event,'CHECKOUT_PAID');
 assert.ok(calls>3);

 const dom=new JSDOM(html,{url:'https://opanquecao.vercel.app/backoffice/?demo=1',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.confirm=()=>true;
 let fetches=0;
 w.fetch=async(url)=>{
  if(url==='/cardapio.json')return{ok:true,json:async()=>catalog};
  if(url==='/delivery-areas.json')return{ok:true,json:async()=>JSON.parse(fs.readFileSync('delivery-areas.json','utf8'))};
  fetches++;throw Error('Demo não deve requisitar API privada');
 };
 w.eval(frontend);
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(d.querySelector('#loginScreen').hidden,true);
 assert.equal(d.querySelectorAll('#ordersTable tr').length,4);
 d.querySelector('[data-tab=customers]').click();
 assert.equal(d.querySelectorAll('#customersTable tr').length,4);
 d.querySelector('[data-tab=cash]').click();
 assert.equal(d.querySelectorAll('#cashCards .cash-tile').length,6);
 assert.equal(d.querySelector('#asaasSandboxCard').hidden,true);
 d.querySelector('[data-tab=catalog]').click();
 assert.ok(d.querySelectorAll('#catalogTable tr').length>=82);
 assert.equal(fetches,0);
 assert.doesNotMatch(frontend,/SUPABASE_SECRET_KEY|DATABASE_URL|ASAAS_SANDBOX_API_KEY/);
 console.log('PASS NEON BACKOFFICE: esquema privado, sessões gerenciadas, permissão, preços lazy, demo isolada, Asaas sandbox e webhook autenticado.');
})().catch(err=>{console.error(err);process.exitCode=1;});
