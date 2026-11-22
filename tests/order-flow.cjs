const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const deliveryAreas=JSON.parse(fs.readFileSync('delivery-areas.json','utf8'));
assert.equal(deliveryAreas.defaultFeeCents['Nova Hartz'],700);
assert.equal(deliveryAreas.defaultFeeCents['Araricá'],1000);
const dom=new JSDOM(html,{url:'https://opanquecao.vercel.app/',runScripts:'outside-only'});
const w=dom.window,d=w.document;
Object.assign(global,{document:d,window:w,Option:w.Option});
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
let lastScrolledSection = null;
w.HTMLElement.prototype.scrollIntoView=function(){ lastScrolledSection = this.id || this.closest('[id]')?.id || null };
Object.defineProperty(global,'navigator',{configurable:true,value:w.navigator});
Object.defineProperty(w.navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){success({coords:{latitude:-29.585,longitude:-50.938,accuracy:18}})}}});
let mockEnabled=false,verified=true,deliver=true,calls=0,intentCalls=0,tokenCb,lastOrder,lastTelegramCaption,lastBotMessage;
const checkoutLogs=[];
const originalInfo=console.info;
console.info=entry=>{
    if(typeof entry==='string' && entry.includes('"event":"checkout"')) checkoutLogs.push(JSON.parse(entry));
    else originalInfo(entry);
};
w.turnstile={render(_,o){tokenCb=o.callback;return 1},reset(){},execute(){tokenCb('token-verified')}};
const handler=require(path.resolve('api/order.js'));
const intentHandler=require(path.resolve('api/whatsapp-intent.js'));
const {PDFDocument}=require(path.resolve('node_modules/pdf-lib'));
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'fake',TURNSTILE_SECRET_KEY:'fake',VERCEL_ENV:'preview'});
global.fetch=async (url,init)=>{
 if(url.endsWith('siteverify'))return {ok:true,json:async()=>({success:verified})};
 if(url.endsWith('sendDocument')){
  calls++;lastTelegramCaption=init.body.get('caption'); const pdf=await PDFDocument.load(await init.body.get('document').arrayBuffer());
  assert.ok(Math.abs(pdf.getPage(0).getWidth()-58*72/25.4)<0.1);
  assert.match(init.body.get('caption'),/TESTE - NAO PREPARAR/);
  assert.match(init.body.get('document').name,/TESTE-nao-preparar/);
  return {ok:deliver,json:async()=>({ok:deliver})};
 }
 if(url.endsWith('/sendMessage')){
   intentCalls++;lastBotMessage=JSON.parse(init.body);
   assert.match(lastBotMessage.text,/PRÉ-REGISTRO DO SITE/);
   assert.match(lastBotMessage.reply_markup.inline_keyboard[0][0].url,/^https:\/\/wa\.me\/55/);
   return {ok:true,json:async()=>({ok:true,result:{message_id:4321}})};
 }
 if(url==='/delivery-areas.json')return {ok:true,json:async()=>deliveryAreas};
 if(url==='/api/order-config')return {ok:true,json:async()=>({siteKey:mockEnabled?'fake':null,testMode:true})};
 if(url==='/api/whatsapp-intent'){
   const response={setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};
   await intentHandler({method:'POST',headers:{host:'opanquecao.vercel.app'},body:JSON.parse(init.body)},response);
   return {ok:response.code===201,json:async()=>({...response.data,test:false})};
 }
 if(url==='/api/order'){
 lastOrder=JSON.parse(init.body);
 const res={setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};
 await handler({method:'POST',body:JSON.parse(init.body)},res);
 return {ok:res.code===200,json:async()=>res.data};
 }
 throw new Error(url);
};
(async()=>{
const inline=[...d.querySelectorAll('script:not([src])')].at(-1).textContent;
w.eval(inline.replace(/\n\s*initMenu\(\);\s*$/,''));
w.eval(fs.readFileSync('meta-pixel.js','utf8'));
d.dispatchEvent(new w.Event('DOMContentLoaded'));
assert.equal(w.fbq,undefined,'Pixel não pode iniciar sem consentimento');
assert.equal(w.XTLMeta.track('AddToCart',{value:5}),false,'Não rastrear sem consentimento');
d.querySelector('#analyticsAccept').click();
assert.equal(typeof w.fbq,'function','Pixel deve iniciar após consentimento positivo');
const metaCalls=()=>[...(w.fbq?.queue||[])].filter(args=>args[0]==='track');
assert.equal(metaCalls().filter(args=>args[1]==='PageView').length,1);
await import(path.resolve('cart.mjs'));
w.renderMenu(catalog);
d.dispatchEvent(new w.CustomEvent('menu-ready',{detail:catalog}));
assert.match(d.querySelector('a.whatsapp-float').textContent,/Chamar no WhatsApp/);
assert.equal(d.querySelectorAll('.category-card').length, catalog.categorias.length);
assert.equal(d.querySelectorAll('.category-section:not([hidden])').length,0,'A home mostra categorias, não a lista inteira de produtos');
assert.equal(d.querySelectorAll('.category-section:not([hidden]) .menu-item').length,0);
assert.equal(d.querySelectorAll('.category-card img').length,12);
assert.equal(d.querySelectorAll('.category-card-media img').length,12);
assert.equal(d.querySelectorAll('.category-card .category-card-title').length,12);
assert.equal(d.querySelectorAll('.category-card .category-card-action').length,12);
assert.equal(d.querySelectorAll('.category-switcher a').length,12);
assert.equal(d.querySelector('#categoryHome').hidden,false);
assert.equal(d.querySelectorAll('.category-section:not([hidden]) .menu-item').length,0);
for (const category of catalog.categorias) {
  const categoryLink=d.querySelector('.category-card[href="#'+category.id+'"]');
  assert.ok(categoryLink,'Falta categoria '+category.id);
  assert.equal(categoryLink.querySelector('.category-card-title').textContent, category.titulo);
  assert.match(categoryLink.querySelector('.category-card-action').textContent,/Ver produtos/);
  assert.ok(categoryLink.querySelector('.category-card-media img')?.getAttribute('src')?.startsWith('img/'),
    'Foto ausente na categoria '+category.id);
}
// Header navigation: contact and directions should scroll to their own
// sections, not reset the focus/scroll to the menu.
const contactTab=d.querySelector('.site-tabs a[href="#contato"]');
const directionsTab=d.querySelector('.site-tabs a[href="#como-chegar"]');
assert.ok(contactTab && directionsTab);
contactTab.click();
assert.equal(w.location.hash,'#contato');
assert.equal(lastScrolledSection,'contato');
assert.equal(d.activeElement.id,'titulo-contato');
assert.equal(contactTab.getAttribute('aria-current'),'page');
directionsTab.click();
assert.equal(w.location.hash,'#como-chegar');
assert.equal(lastScrolledSection,'como-chegar');
assert.equal(d.activeElement.id,'titulo-local');
assert.equal(directionsTab.getAttribute('aria-current'),'page');
assert.equal(contactTab.hasAttribute('aria-current'),false);
assert.ok(d.querySelector('#como-chegar a[href^="https://www.google.com/maps/search/"]'));
assert.ok(d.querySelector('#como-chegar a[href^="https://www.google.com/maps/dir/"]'));
w.history.replaceState(null,'','#contato');
w.dispatchEvent(new w.PopStateEvent('popstate'));
assert.equal(lastScrolledSection,'contato');
d.querySelector('.site-tabs a[href="#cardapio"]').click();
assert.equal(w.location.hash,'#cardapio');
assert.equal(d.querySelector('#categoryHome').hidden,false);
assert.equal(d.querySelector('.site-tabs a[href="#cardapio"]').getAttribute('aria-current'),'page');
d.querySelector('.category-card[href="#panquecas-salgadas"]').click();
assert.equal(d.querySelector('#panquecas-salgadas').hidden,false);
assert.equal(d.querySelectorAll('.category-section:not([hidden])').length,1);
assert.equal(d.querySelector('#categoryHome').hidden,true);
assert.equal(d.querySelector('#categoryToolbar').hidden,false);
assert.equal(d.querySelector('.category-switcher a[href="#panquecas-salgadas"]').getAttribute('aria-current'),'true');
d.querySelector('.category-switcher a[href="#panquecas-doces"]').click();
assert.equal(d.querySelector('#panquecas-doces').hidden,false);
assert.equal(d.querySelector('#panquecas-salgadas').hidden,true);
assert.equal(d.querySelectorAll('.category-section:not([hidden])').length,1);
assert.equal(d.querySelector('.category-switcher a[href="#panquecas-doces"]').getAttribute('aria-current'),'true');
assert.equal(d.querySelector('.category-switcher a[href="#panquecas-salgadas"]').hasAttribute('aria-current'),false);
d.querySelector('.category-toolbar > a').click();
assert.equal(d.querySelector('#categoryHome').hidden,false);
assert.equal(d.querySelectorAll('.category-section:not([hidden]) .menu-item').length,0);
d.querySelector('.category-card[href="#panquecas-salgadas"]').click();
const card=d.querySelector('#panquecas-salgadas .menu-item');
card.querySelector('.product-details').click();
const f=d.querySelector('#productDialogContent form');
assert.equal(d.querySelectorAll('#productDialogContent .size-grid').length,0,'Não duplicar tabela de preços da ficha');
f.querySelector('[data-adjust="1"]').click();
assert.equal(f.elements.quantity.value,'2');
f.querySelector('[data-adjust="-1"]').click();
assert.equal(f.elements.quantity.value,'1');
f.elements.quantity.value='2';f.elements.note.value='Embalagens separadas';
f.onsubmit({preventDefault(){}});
assert.equal(metaCalls().filter(args=>args[1]==='AddToCart').length,1,
    'Uma inclusão de produto deve emitir um AddToCart');
const firstCartMeta=metaCalls().find(args=>args[1]==='AddToCart')[2];
assert.equal(firstCartMeta.currency,'BRL');
assert.equal(firstCartMeta.num_items,2);
assert.equal(firstCartMeta.value,56);
assert.equal(firstCartMeta.contents[0].quantity,2);
assert.match(d.querySelector('#openCart').textContent,/Pedido · 2 itens/);
assert.match(d.querySelector('#cartFeedback').textContent,/adicionado/);
assert.equal(JSON.parse(w.localStorage.getItem('disk-panquecao-cart-v1')).lines[0].quantity,2);
assert.equal(d.querySelector('#cartFeedback').hidden,false);
d.querySelector('#cartFeedbackCart').click();
assert.equal(d.getElementById('cartDialog').open,true,
    'Ver pedido no aviso deve abrir carrinho, não a ficha do produto');
assert.equal(d.getElementById('productDialog').open,false,
    'Produto não pode reabrir ao tocar no aviso Ver pedido');
d.getElementById('cartDialog').close();
await d.querySelector('#openCart').onclick();
assert.equal(d.querySelector('#checkout').hidden,true);
assert.equal(d.querySelector('#startCheckout').hidden,false);
d.querySelector('#startCheckout').click();
assert.equal(metaCalls().filter(args=>args[1]==='InitiateCheckout').length,1,
    'Início do checkout deve ser medido uma única vez');
assert.equal(d.querySelector('#checkout').hidden,false);
assert.equal(d.querySelector('#cartWhatsApp'),null);
assert.equal(d.querySelector('#orderUnavailable'),null);
assert.equal(d.querySelector('#sendOrder').disabled,false);
assert.match(d.querySelector('.cart-note').textContent,/Embalagens separadas/);
d.querySelector('#cartLines [aria-label^="Aumentar quantidade"]').click();
assert.equal(d.querySelector('.cart-stepper span').textContent,'3');
assert.match(d.querySelector('#cartLines').textContent,/3/);
d.querySelector('#cartLines [aria-label^="Diminuir quantidade"]').click();
assert.equal(d.querySelector('.cart-stepper span').textContent,'2');
d.querySelector('#cartDialog').close();
await d.querySelector('#openCart').onclick();
const checkout=d.querySelector('#checkout');
assert.ok(checkout.elements.orderNote,'Observações opcionais');
assert.equal(checkout.querySelectorAll('[required]').length,6,'Nome, WhatsApp, cidade, bairro, rua e número para entrega');
assert.ok(checkout.querySelector('[name="customerName"]'));
assert.ok(checkout.querySelector('[name="customerPhone"]'));
assert.equal(checkout.querySelector('[name="paymentMethod"]'),null);
assert.ok(checkout.querySelector('[name="fulfillmentType"][value="delivery"]'));
assert.ok(checkout.querySelector('[name="fulfillmentType"][value="pickup"]'));
assert.ok(checkout.querySelector('[name="fulfillmentType"][value="table"]'));
assert.equal(checkout.querySelector('[name="cpf"]'),null,'Não coletar CPF do cliente');
checkout.elements.customerName.value='Cliente fictício';
checkout.elements.customerPhone.value='(51) 99999-9999';
checkout.elements.orderNote.value='Por favor, confirmar antes de preparar';
checkout.elements.deliveryCity.value='Nova Hartz';
checkout.elements.deliveryCity.dispatchEvent(new w.Event('change',{bubbles:true}));
await new Promise(resolve=>setImmediate(resolve));
assert.ok(checkout.elements.deliveryNeighborhood.querySelector('option[value="Centro"]'),
    'Bairros de Nova Hartz carregados do catálogo existente');
checkout.elements.deliveryNeighborhood.value='Centro';
checkout.elements.deliveryStreet.value='Rua das Flores';
checkout.elements.deliveryNumber.value='123';
checkout.elements.deliveryComplement.value='Casa 2';
checkout.elements.deliveryReference.value='Portão azul';
d.querySelector('#captureDeliveryLocation').click();
assert.match(d.querySelector('#deliveryLocationStatus').textContent,/Ponto registrado/);
assert.match(d.querySelector('#deliveryLocationPreview').href,/maps\?q=-29\.585,-50\.938/);
checkout.elements.orderNote.dispatchEvent(new w.Event('input',{bubbles:true}));
mockEnabled=true;
const submit=()=>checkout.onsubmit({preventDefault(){},currentTarget:checkout});
await submit();
assert.equal(metaCalls().filter(args=>args[1]==='Lead').length,1,
    'Pré-registro confirmado deve emitir Lead, nunca Purchase');
const leadMeta=metaCalls().find(args=>args[1]==='Lead')[2];
assert.equal(leadMeta.value,0,'Pré-registro não representa faturamento');
assert.equal(leadMeta.status,'pending_whatsapp_confirmation');
assert.equal(metaCalls().filter(args=>args[1]==='Purchase').length,0,
    'Não registrar faturamento antes da confirmação pela loja');
assert.doesNotMatch(JSON.stringify(metaCalls()),/Cliente fictício|99999-9999|Rua das Flores|\-29\.585/,
    'Eventos Meta não devem enviar nome, telefone, endereço nem GPS');
assert.equal(calls,0,'A API PDF legada não deve ser chamada');
assert.equal(intentCalls,1,'Pré-registro deve chegar ao bot: '+d.querySelector('#orderStatus').textContent);
assert.match(lastBotMessage.text,/Cliente fictício/);
assert.match(lastBotMessage.text,/Embalagens separadas/);
assert.match(lastBotMessage.text,/Rua das Flores, 123/);
assert.match(lastBotMessage.text,/Bairro\/localidade: Centro/);
assert.match(lastBotMessage.text,/maps\?q=-29\.585,-50\.938/);
assert.match(lastBotMessage.text,/Taxa de entrega: A CONFIRMAR PELA LOJA/);
assert.match(lastBotMessage.reply_markup.inline_keyboard[0][0].url,/51999999999/);
let directUrl=d.querySelector('#whatsappOrderLink').href;
assert.match(directUrl,/^https:\/\/wa\.me\/5551997383849\?text=/);
let directMessage=new URL(directUrl).searchParams.get('text');
assert.match(directMessage,/Embalagens separadas/);
assert.match(directMessage,/Por favor, confirmar antes de preparar/);
assert.match(directMessage,/Subtotal \(sem entrega\):/);
assert.match(directMessage,/Modalidade: Entrega/);
assert.match(directMessage,/Rua das Flores, 123/);
assert.match(directMessage,/maps\?q=-29\.585,-50\.938/);
assert.match(directMessage,/Taxa de entrega: A CONFIRMAR PELA LOJA/);
assert.match(directMessage,/Cliente fictício/);
assert.match(directMessage,/Referência: #[0-9A-F]{8}/);
assert.doesNotMatch(directMessage,/Forma: Pix|WhatsApp: 51|Taxa: R\$/);
await submit();
assert.equal(intentCalls,1,'Não duplicar pré-registro na mesma sessão sem alterações');
assert.equal(metaCalls().filter(args=>args[1]==='Lead').length,1,
    'Não duplicar conversão Meta ao reabrir o mesmo pré-registro');
assert.equal(d.querySelector('#cartEmpty').hidden,true,'Carrinho deve permanecer até confirmação');
assert.equal(d.querySelector('#cartFeedback').hidden,true,'O aviso deve ser ocultado quando Ver pedido foi acionado');
assert.ok(d.querySelector('#cartFeedbackCart'));
const beverage=d.querySelector('#bebidas .menu-item .quick-add');
assert.ok(beverage,'Bebidas simples precisam de Adicionar em um toque');
beverage.click();
assert.equal(metaCalls().filter(args=>args[1]==='AddToCart').length,2,
    'Adição rápida deve emitir AddToCart');
assert.match(d.querySelector('#openCart').textContent,/3 itens/);
// The full card opens exactly one form, including açaí configuration.
d.querySelector('.category-card[href="#acai"]').click();
d.querySelector('#acai [data-option="500ml"] .item-photo img').click();
assert.equal(d.querySelectorAll('#productDialogContent form').length,1);
let acaiForm=d.querySelector('#productDialogContent form');
const free=()=>[...acaiForm.querySelectorAll('input[name="freeExtra"]')];
for(let i=0;i<4;i++)free()[i].click();
assert.equal(free().filter(i=>i.checked).length,4);
assert.equal(free()[4].disabled,true);
d.querySelector('#productDialog').close();
d.querySelector('#acai [data-option="300ml"] .item-photo img').click();
acaiForm=d.querySelector('#productDialogContent form');
for(let i=0;i<3;i++)free()[i].click();
assert.equal(free()[3].disabled,true);
acaiForm.querySelector('input[name="paidExtra"]').click();
assert.match(acaiForm.querySelector('.order-primary').textContent,/25,00/);
acaiForm.onsubmit({preventDefault(){}});
const cartText=d.querySelector('#cartLines').textContent;
assert.match(cartText,/Complementos grátis/);assert.match(cartText,/Adicional de Nutella/);
const {priceOrder,flavorChoices,orderOptions}=await import(path.resolve('order-catalog.mjs'));
const line=JSON.parse(w.localStorage.getItem('disk-panquecao-cart-v1')).lines.at(-1);
assert.equal(priceOrder(catalog,[{...line,cents:1}])[0].cents,2500);
assert.throws(()=>priceOrder(catalog,[{...line,freeExtras:['Inventado']}]));
assert.throws(()=>priceOrder(catalog,[{...line,paidExtras:['Adicional de Nutella','Adicional de Nutella']}]));
assert.throws(()=>priceOrder(catalog,[{...line,freeExtras:catalog.categorias.find(c=>c.id==='acai').itens[0].tags.slice(0,4)}]));
// As três panquecas meio a meio exigem escolhas distintas e compatíveis com o cardápio.
const flavorTests=[
  ['Panqueca Meio a Meio (2 Sabores Salgados)','Bacon','Calabresa',15,15],
  ['Panqueca Meio a Meio (2 Sabores Doces)','Banana e Canela','Chocolate Branco',14,14],
  ['Panqueca Meio a Meio (Salgada e Doce)','Bacon','Chocolate Branco',15,14]
];
d.querySelector('.category-card[href="#panquecas-2-sabores"]').click();
for(const [product,first,second,leftCount,rightCount] of flavorTests) {
  const card=[...d.querySelectorAll('#panquecas-2-sabores .menu-item')].find(x=>x.dataset.product===product);
  assert.ok(card,'Produto dois sabores não encontrado: '+product);
  card.querySelector('.product-details').click();
  const form=d.querySelector('#productDialogContent form');
  const fields=[...form.querySelectorAll('.flavor-choices select')];
  assert.equal(fields.length,2);
  assert.equal(fields[0].required,true);
  assert.equal(fields[1].required,true);
  assert.equal(fields[0].value,'');
  assert.equal(fields[1].value,'');
  assert.equal(fields[0].options.length,leftCount+1);
  assert.equal(fields[1].options.length,rightCount+1);
  const choices=flavorChoices(catalog,'panquecas-2-sabores',product);
  assert.equal(choices[0].options.length,leftCount);
  assert.equal(choices[1].options.length,rightCount);
  const fakeLine={category:'panquecas-2-sabores',product,option:'Único',quantity:1,note:'',flavors:[first,second]};
  assert.equal(priceOrder(catalog,[fakeLine])[0].cents,4200);
  assert.deepEqual(priceOrder(catalog,[fakeLine])[0].flavors,[first,second]);
  assert.throws(()=>priceOrder(catalog,[{...fakeLine,flavors:[]}]),/sabores válidos/);
  assert.throws(()=>priceOrder(catalog,[{...fakeLine,flavors:[first,first]}]),/diferentes/);
  assert.throws(()=>priceOrder(catalog,[{...fakeLine,flavors:['Inexistente',second]}]),/sabores válidos/);
  form.onsubmit({preventDefault(){}});
  assert.match(form.querySelector('[role="status"]').textContent,/sabores válidos/);
  fields[0].value=first;
  fields[1].value=second;
  form.onsubmit({preventDefault(){}});
  assert.equal(d.querySelector('#productDialog').open,false);
  const items=JSON.parse(w.localStorage.getItem('disk-panquecao-cart-v1')).lines;
  assert.deepEqual(items.at(-1).flavors,[first,second]);
  assert.match(d.querySelector('#cartLines').textContent,new RegExp(first));
  assert.match(d.querySelector('#cartLines').textContent,new RegExp(second));
}
assert.equal(d.querySelectorAll('.category-section:not([hidden])').length,1);
const secondOfTwo=flavorTests[0];
const baconItem=catalog.categorias.find(c=>c.id==='panquecas-salgadas').itens.find(x=>x.nome==='Bacon');
assert.throws(()=>priceOrder(catalog,[{category:'panquecas-salgadas',product:'Bacon',option:orderOptions(baconItem)[0].label,quantity:1,note:'',flavors:[secondOfTwo[1],secondOfTwo[2]]}]),/não permite/);

// Conferir sabores e adicionais no link produzido, sem retornar ao checkout.
checkout.elements.orderNote.value='';
await submit();
assert.equal(calls,0);
directMessage=new URL(d.querySelector('#whatsappOrderLink').href).searchParams.get('text');
assert.match(directMessage,/Sabores: Bacon \/ Calabresa/);
assert.match(directMessage,/^\d+\. \d+x /m);
assert.match(directMessage,/Grátis:/);
assert.match(directMessage,/Adicionais:/);
assert.equal(d.querySelector('#cartEmpty').hidden,true);
const resFor=()=>({setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}});
const request={method:'POST',body:{name:'Cliente fictício',phone:'51999999999',challenge:'fake',payment:{method:'pix',changeForCents:null},lines:[line],fulfillment:{type:'pickup',address:'',table:'',latitude:null,longitude:null}}};
let response=resFor();await handler(request,response);assert.equal(response.code,200);assert.equal(calls,1);
response=resFor();await handler({...request,body:{...request.body,fulfillment:{type:'delivery',street:'Rua Flores',number:'123',city:'Caxias do Sul',neighborhood:'Centro'}}},response);
assert.equal(response.code,400);assert.equal(calls,1);
const deliveryBase={type:'delivery',city:'Nova Hartz',neighborhood:'Centro',street:'Rua das Flores',number:'123',postalCode:'93890-000',complement:'',reference:''};
response=resFor();await handler({...request,body:{...request.body,fulfillment:{...deliveryBase,number:''}}},response);
assert.equal(response.code,400);assert.equal(calls,1);
response=resFor();await handler({...request,body:{...request.body,fulfillment:{...deliveryBase,neighborhood:'Inventado'}}},response);
assert.equal(response.code,400);assert.equal(calls,1);
response=resFor();await handler({...request,body:{...request.body,fulfillment:{...deliveryBase,postalCode:'inválido'}}},response);
assert.equal(response.code,400);assert.equal(calls,1);
response=resFor();await handler({...request,body:{...request.body,fulfillment:{type:'table',table:'',address:''}}},response);
assert.equal(response.code,400);assert.equal(calls,1);
response=resFor();await handler({...request,body:{...request.body,fulfillment:{...deliveryBase,latitude:'999',longitude:'0'}}},response);
assert.equal(response.code,400);assert.equal(calls,1);
// O valor por bairro só é cobrado quando definido na tabela do servidor.
// O cliente nunca fornece o preço; a API recalcula o frete.
const serverAreas=require(path.resolve('delivery-areas.json'));
const centerArea=serverAreas.cities['Nova Hartz'].find(a=>a.name==='Centro');
assert.equal(centerArea.feeCents,null);
centerArea.feeCents=450;
try {
 response=resFor();await handler({...request,body:{...request.body,fulfillment:{...deliveryBase,feeCents:0}}},response);
 assert.equal(response.code,200);assert.equal(calls,2);
 assert.match(lastTelegramCaption,/Taxa:.*4,50/);
 assert.match(lastTelegramCaption,/Total:/);
} finally { centerArea.feeCents=null; }
response=resFor();await handler({...request,body:{...request.body,fulfillment:{...deliveryBase,neighborhood:'__other__',otherNeighborhood:'Estrada particular'}}},response);
assert.equal(response.code,200);assert.equal(calls,3);
assert.match(lastTelegramCaption,/Taxa: a confirmar/);
const araricaBase={...deliveryBase,city:'Araricá',neighborhood:'Centro',street:'Rua Central'};
response=resFor();await handler({...request,headers:{'x-checkout-trace':'test1234'},body:{...request.body,fulfillment:araricaBase}},response);
assert.equal(response.code,200);assert.equal(calls,4);
assert.match(lastTelegramCaption,/Taxa:.*10,00/);
assert.equal(response.data.trace,'test1234');
assert.ok(checkoutLogs.some(x=>x.trace==='test1234'&&x.step==='received'));
assert.ok(checkoutLogs.some(x=>x.trace==='test1234'&&x.step==='sent'));
assert.ok(checkoutLogs.every(x=>!JSON.stringify(x).includes('Cliente fictício')));
process.env.ORDER_ESTIMATE_DELIVERY_MIN='45';
const config=require(path.resolve('api/order-config.js'));
const configRes={setHeader(){},json(data){this.data=data;return this}};
config({method:'GET'},configRes);assert.equal(configRes.data.deliveryEstimateMinutes,45);
delete process.env.ORDER_ESTIMATE_DELIVERY_MIN;
console.info=originalInfo;
console.log('PASS: cardápio, carrinho, pedido simples WhatsApp, sabores, adicionais e validação API legada isolada.');
})().catch(e=>{console.error(e);process.exitCode=1});
