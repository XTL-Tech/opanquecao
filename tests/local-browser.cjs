'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const base='http://127.0.0.1:8765';
const html=fs.readFileSync('index.html','utf8'),catalog=require('../cardapio.json'),areas=require('../delivery-areas.json');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.addInitScript(()=>{let cb;window.turnstile={render:(el,o)=>{cb=o.callback;return 1;},reset(){},execute(){cb('fake-test-challenge');}};localStorage.setItem('disk-panquecao-analytics-consent-v1','rejected');});
 const page=await ctx.newPage(),errors=[];let open=true,submitted=0,requestId;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
 if(u.pathname==='/local')return route.fulfill({contentType:'text/html',body:html});
 if(u.pathname==='/api/catalog')return route.fulfill({json:catalog});
 if(u.pathname==='/api/order-config')return route.fulfill({json:{digitalOrders:true,deliveryAccountRequired:true,siteKey:'fake',testMode:false}});
 if(u.pathname==='/api/store-status')return route.fulfill({json:{enabled:true,open,reason:open?'open':'closed',date:'2026-11-27'}});
 if(u.pathname==='/delivery-areas.json')return route.fulfill({json:areas});
 if(u.pathname==='/api/whatsapp-intent'&&req.method()==='POST'){
   const body=req.postDataJSON();assert.equal(body.fulfillment.type,'table');assert.equal(body.fulfillment.table,'04');assert.equal(body.phone,'');assert.equal(body.name,'Cliente presencial');assert.ok(!body.cpf);submitted++;requestId=body.requestId;return route.fulfill({json:{id:'TESTE001',digital:true,status:'registered',test:false,deliveryFeeCents:null,telegramConfirmed:true}});
 }
 if(u.pathname==='/api/delivery-status'&&req.method()==='POST'){assert.equal(req.postDataJSON().id,requestId);return route.fulfill({json:{status:'accepted'}});}
 if(u.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Não disponível no teste'}});
 if(req.method()!=='GET')return route.abort();return route.continue();
 });
 await page.goto(base+'/local');await page.waitForFunction(()=>document.body.classList.contains('digital-order-mode')&&window.storeOperationStatus?.open);
 assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'),'/local.webmanifest');
 await page.locator('.category-card[href="#bebidas"]').click();
 await page.locator('#bebidas .quick-add').first().click();
 await page.locator('#openCart').click();await page.locator('#startCheckout').click();
 assert.equal(await page.locator('#customerName').isVisible(),false);
 assert.equal(await page.locator('#deliveryFields').isVisible(),false);
 assert.equal(await page.locator('#tableIdentifier').isVisible(),true);
 await page.locator('#tableIdentifier').fill('04');await page.locator('#sendOrder').click();
 await page.locator('#digitalOrderReceipt').waitFor({state:'visible'});
 assert.match(await page.locator('#digitalOrderMessage').textContent(),/Sem frete/);
 await page.locator('#digitalOrderCheck').click();await page.waitForFunction(()=>document.querySelector('#digitalOrderMessage').textContent.includes('Aceito'));
 await page.locator('#digitalOrderClear').click();assert.equal(await page.locator('#digitalOrderReceipt').isVisible(),false);assert.equal(submitted,1);
 open=false;await page.reload();await page.waitForFunction(()=>window.storeOperationStatus?.open===false&&!window.storeOperationStatus?.unknown);
 assert.equal(await page.locator('#openCart').isVisible(),false);assert.equal(await page.locator('a.whatsapp-float').isVisible(),false);
 assert.equal(submitted,1);assert.deepEqual(errors,[]);await ctx.close();
 console.log('PASS Chromium local: PWA entry, table without CPF/phone, digital checkout, tracking, reset and closed mode (fake providers)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
