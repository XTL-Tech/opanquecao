'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const c=require('../lib/backoffice-core');
const handler=require('../api/backoffice');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const html=fs.readFileSync('backoffice/index.html','utf8');
const js=fs.readFileSync('backoffice/app.js','utf8');
const migration=fs.readFileSync('supabase/migrations/202611220005_backoffice.sql','utf8');
const original=structuredClone(catalog);
assert.equal(c.formatPrice(3200),'R$ 32,00');
assert.throws(()=>c.formatPrice(-100));
assert.throws(()=>c.name(''));
assert.equal(c.phone('(51) 99999-9999'),'51999999999');
assert.equal(c.statusAllowed('pending_customer','awaiting_acceptance'),true);
assert.equal(c.statusAllowed('pending_customer','delivered'),false);
assert.equal(c.statusAllowed('delivered','accepted'),false);
const updated=c.applyPrice(catalog,{category:'panquecas-salgadas',product:'Panquetudo (Especial)',variant:'size:M',priceCents:3500});
assert.equal(updated.categorias.find(x=>x.id==='panquecas-salgadas').itens.find(x=>x.nome==='Panquetudo (Especial)').tamanhos.M,'R$ 35,00');
assert.deepEqual(catalog,original,'Editar preços não deve mutar catálogo original');
assert.throws(()=>c.applyPrice(catalog,{category:'none',product:'xyz',variant:'preco',priceCents:100}));
assert.throws(()=>c.applyPrice(catalog,{category:'bebidas',product:'Vinhos',variant:'unknown',priceCents:100}));
const today=c.businessDate();
assert.match(today,/^\d{4}-\d\d-\d\d$/);
const mockOrder={status:'delivered',payment_status:'paid',settled_business_date:today,fulfillment:{type:'pickup'},
 subtotal_cents:1000,delivery_fee_cents:null,payment_method:'cash'};
const sums=c.tally([mockOrder,{...mockOrder,status:'pending_customer'},{
 ...mockOrder,settled_business_date:'2000-01-01'}],today);
assert.deepEqual(sums,{orders:1,total_cents:1000,cash_cents:1000,pix_cents:0,credit_cents:0,debit_cents:0,other_cents:0});
assert.equal(c.orderTotal({...mockOrder,fulfillment:{type:'delivery'}}),null);
for(const table of ['restaurant_staff','restaurant_customers','restaurant_orders','restaurant_order_events','restaurant_cash_closings']){
 assert.match(migration,new RegExp('alter table public\\.'+table+' enable row level security;'));
 assert.match(migration,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated;'));
}
assert.match(migration,/restaurant_cash_closing_guard/);
assert.match(migration,/pg_advisory_xact_lock/);
assert.doesNotMatch(migration,/create policy .* to anon/i);
assert.match(html,/noindex,nofollow/);
assert.ok(html.includes('/backoffice/app.js'));
assert.doesNotMatch(js,/localStorage|sessionStorage|SUPABASE_SECRET_KEY/);
const response=()=>({code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
(async()=>{
 delete process.env.BACKOFFICE_ENABLED;
 let res=response();
 await handler({method:'GET',query:{action:'status'},headers:{}},res);
 assert.equal(res.code,200);assert.equal(res.body.enabled,false);
 res=response();
 await handler({method:'GET',query:{action:'dashboard'},headers:{}},res);
 assert.equal(res.code,503,'Sem banco, fail-closed');
 res=response();
 await handler({method:'POST',headers:{host:'opanquecao.vercel.app',origin:'https://malicioso.invalid'},body:{action:'login'}},res);
 assert.equal(res.code,403,'CSRF cross-origin bloqueado');
 Object.assign(process.env,{
  BACKOFFICE_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'pub-fake',SUPABASE_SECRET_KEY:'secret-fake'
 });
 const user='11111111-1111-4111-8111-111111111111';
 let n=0;
 global.fetch=async(url,opts)=>{
  n++;
  const path=String(url);
  let data;
  if(path.includes('/auth/v1/token?'))data={access_token:'eyJ.fake.access',refresh_token:'refresh_token_123',expires_in:3600};
  else if(path.includes('/auth/v1/user'))data={id:user,email:'gestor@exemplo.invalid'};
  else if(path.includes('/rest/v1/restaurant_staff'))data=[{user_id:user,role:'manager',active:true}];
  else if(path.includes('/rest/v1/restaurant_catalogs'))data=[{catalog,revision:1,updated_at:new Date().toISOString()}];
  else data=[];
  return {ok:true,status:200,text:async()=>JSON.stringify(data),json:async()=>data};
 };
 res=response();
 await handler({method:'POST',headers:{host:'opanquecao.vercel.app',origin:'https://opanquecao.vercel.app'},
  body:{action:'login',email:'gestor@exemplo.invalid',password:'senha-ficticia'}},res);
 assert.equal(res.code,200,'Login simulado deve funcionar');
 assert.equal(res.body.actor.role,'manager');
 assert.ok(res.headers['Set-Cookie'].every(v=>v.includes('HttpOnly')&&v.includes('Secure')&&v.includes('SameSite=Strict')));
 assert.doesNotMatch(JSON.stringify(res.body),/senha-ficticia|refresh_token/);
 res=response();
 await handler({method:'GET',query:{action:'session'},headers:{
  cookie:'__Host-dp_access=eyJ.fake.access; __Host-dp_refresh=refresh_token_123'
 }},res);
 assert.equal(res.code,200);
 assert.equal(res.body.actor.email,'gestor@exemplo.invalid');
 res=response();
 await handler({method:'GET',query:{action:'dashboard'},headers:{
  cookie:'__Host-dp_access=eyJ.fake.access'
 }},res);
 assert.equal(res.code,200);
 assert.equal(res.body.catalog.revision,1);
 assert.equal(res.body.orders.length,0);
 res=response();
 await handler({method:'POST',headers:{host:'opanquecao.vercel.app',origin:'https://opanquecao.vercel.app',
  cookie:'__Host-dp_access=eyJ.fake.access'},body:{action:'order_status',id:'x',next:'delivered'}},res);
 assert.equal(res.code,400,'API valida identificador do pedido');
 assert.ok(n>=5,'Autenticação e dados consultados no servidor');

 // Navegação interativa DEMO, sem acesso ao backoffice nem a PII reais.
 const dom=new JSDOM(html,{url:'https://opanquecao.vercel.app/backoffice/?demo=1',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.confirm=()=>true;
 let publicFetches=0,adminFetches=0;
 w.fetch=async url=>{
  if(url==='/cardapio.json'){publicFetches++;return{ok:true,json:async()=>catalog};}
  if(url==='/delivery-areas.json')return{ok:true,json:async()=>JSON.parse(fs.readFileSync('delivery-areas.json','utf8'))};
  adminFetches++;throw Error('Demo não pode consultar API privada');
 };
 w.eval(js);
 async function settle(){await new Promise(r=>setTimeout(r,25));}
 await settle();
 assert.equal(d.getElementById('loginScreen').hidden,true,'Demo deve abrir sem credenciais');
 assert.equal(d.getElementById('appShell').hidden,false);
 assert.equal(d.getElementById('demoRibbon').hidden,false);
 assert.equal(d.querySelectorAll('#ordersTable tr').length,4);
 assert.equal(publicFetches,0,'A abertura demo não exige catálogo');
 d.querySelector('[data-tab="customers"]').click();
 assert.equal(d.getElementById('tab-customers').hidden,false);
 assert.equal(d.querySelectorAll('#customersTable tr').length,4);
 d.getElementById('newCustomer').click();
 assert.equal(d.getElementById('customerDialog').open,true);
 d.getElementById('customerName').value='Pessoa Exemplo Nova';
 d.getElementById('customerPhone').value='51000000009';
 d.getElementById('customerForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await settle();
 assert.equal(d.querySelectorAll('#customersTable tr').length,5,'Cadastro demo deve funcionar');
 d.querySelector('[data-tab="catalog"]').click();
 assert.equal(d.getElementById('tab-catalog').hidden,false);
 await settle();assert.equal(publicFetches,1);
 assert.ok(d.querySelectorAll('#catalogTable tr').length>=82);
 d.querySelector('#catalogTable .td-btn').click();
 assert.equal(d.getElementById('priceDialog').open,true);
 d.querySelector('[data-tab="cash"]').click();
 assert.equal(d.getElementById('tab-cash').hidden,false);
 assert.ok(d.querySelectorAll('#cashCards .cash-tile').length>=6);
 assert.equal(adminFetches,0,'Demo precisa ser 100% isolado da API administrativa');
 console.log('PASS BACKOFFICE: validações, estados, caixa, preço versionado, RLS, login/cookie HttpOnly, proteção de origem e demo interativa sem dados reais.');
})().catch(err=>{console.error(err);process.exitCode=1});
