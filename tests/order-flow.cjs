const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const dom=new JSDOM(html,{url:'https://opanquecao.vercel.app/',runScripts:'outside-only'});
const w=dom.window,d=w.document;
Object.assign(global,{document:d,window:w,Option:w.Option});
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.HTMLElement.prototype.scrollIntoView=function(){};
let mockEnabled=false,verified=true,deliver=true,calls=0,tokenCb;
w.turnstile={render(_,o){tokenCb=o.callback;return 1},reset(){}};
const handler=require(path.resolve('api/order.js'));
const {PDFDocument}=require(path.resolve('node_modules/pdf-lib'));
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'fake',TURNSTILE_SECRET_KEY:'fake'});
global.fetch=async (url,init)=>{
 if(url.endsWith('siteverify'))return {json:async()=>({success:verified})};
 if(url.endsWith('sendDocument')){
  calls++; const pdf=await PDFDocument.load(await init.body.get('document').arrayBuffer());
  assert.ok(Math.abs(pdf.getPage(0).getWidth()-58*72/25.4)<0.1);
  return {ok:deliver,json:async()=>({ok:deliver})};
 }
 if(url==='/api/order-config')return {json:async()=>({siteKey:mockEnabled?'fake':null})};
 if(url==='/api/order'){
 const res={setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};
 await handler({method:'POST',body:JSON.parse(init.body)},res);
 return {ok:res.code===200,json:async()=>res.data};
 }
 throw new Error(url);
};
(async()=>{
const inline=[...d.querySelectorAll('script:not([src])')].at(-1).textContent;
w.eval(inline.replace("document.addEventListener('DOMContentLoaded', initMenu);",""));
await import(path.resolve('cart.mjs'));
w.renderMenu(catalog);
d.dispatchEvent(new w.CustomEvent('menu-ready',{detail:catalog}));
assert.match(d.querySelector('a.whatsapp-float').textContent,/Chamar no WhatsApp/);
const card=d.querySelector('#panquecas-salgadas .menu-item');
card.querySelector('.product-details').click();
const f=d.querySelector('#productDialogContent form');
f.elements.quantity.value='2';f.elements.note.value='Embalagens separadas';
f.onsubmit({preventDefault(){}});
assert.match(d.querySelector('#openCart').textContent,/Fazer pedido \(2\)/);
await d.querySelector('#openCart').onclick();
assert.equal(d.querySelector('#checkout').hidden,true);
assert.match(decodeURIComponent(d.querySelector('#cartWhatsApp').href),/Embalagens separadas/);
assert.doesNotMatch(decodeURIComponent(d.querySelector('#cartWhatsApp').href),/Subtotal|R\$/);
assert.match(d.querySelector('.cart-note').textContent,/Embalagens separadas/);
d.querySelector('[aria-label^="Aumentar quantidade"]').click();
assert.equal(d.querySelector('.cart-stepper span').textContent,'3');
assert.match(decodeURIComponent(d.querySelector('#cartWhatsApp').href),/3 ×/);
d.querySelector('[aria-label^="Diminuir quantidade"]').click();
assert.equal(d.querySelector('.cart-stepper span').textContent,'2');
d.querySelector('#cartDialog').close();
mockEnabled=true; await d.querySelector('#openCart').onclick();
const checkout=d.querySelector('#checkout');
checkout.elements.name.value='Cliente fictício';
checkout.elements.phone.value='(51) 99999-9999';
checkout.elements.consent.checked=true;
async function submit(){tokenCb('fake');await checkout.onsubmit({preventDefault(){},currentTarget:checkout})}
verified=false;await submit();assert.equal(calls,0);
verified=true;deliver=false;await submit();assert.equal(calls,1);assert.equal(d.querySelector('.cart-stepper span').textContent,'2');
deliver=true;await submit();assert.equal(calls,2);assert.match(d.querySelector('#orderStatus').textContent,/Aguarde a confirmação/);assert.equal(d.querySelector('#cartEmpty').hidden,false);
console.log('PASS: seleção, carrinho, WhatsApp sem bot, bloqueio do Turnstile, erro preserva carrinho e confirmação com PDF 58 mm.');
})().catch(e=>{console.error(e);process.exitCode=1});
