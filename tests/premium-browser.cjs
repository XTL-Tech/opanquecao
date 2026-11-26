'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const base='http://127.0.0.1:8765';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const ctx=await browser.newContext({viewport, reducedMotion:'no-preference'});
  const page=await ctx.newPage(),errors=[],outgoing=[],mutations=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==base){outgoing.push(url.hostname);return route.abort();}
   if(req.method()!=='GET'){mutations.push(url.pathname);return route.abort();}
   if(url.pathname==='/api/catalog')return route.fulfill({json:catalog});
   return route.continue();
  });
  await page.goto(base+'/?xtl_demo_loja=aberta');
  await page.locator('.category-card').first().waitFor();
  await page.waitForFunction(()=>window.storeOperationStatus?.open===true);
  assert.equal(await page.locator('.category-card').count(),12);
  assert.equal(await page.locator('#openCart').isVisible(),false);
  assert.equal(await page.locator('a.whatsapp-float').isVisible(),true);
  assert.equal(await page.locator('#heroDots button').count(),4);
  await page.mouse.move(1,1);
  await page.waitForFunction(()=>document.querySelector('#heroDots button:nth-child(2)').getAttribute('aria-current')==='true',{},{timeout:9000});
  await page.locator('#heroPause').click();
  const active=await page.locator('#heroDots [aria-current=true]').getAttribute('aria-label');
  await page.waitForTimeout(6500);
  assert.equal(await page.locator('#heroDots [aria-current=true]').getAttribute('aria-label'),active);
  await page.locator('#heroNext').click();
  assert.notEqual(await page.locator('#heroDots [aria-current=true]').getAttribute('aria-label'),active);
  assert.equal(await page.locator('.premium-hero-media img').evaluate(im=>im.complete&&im.naturalWidth>0),true);
  await page.locator('#premiumSearch').fill('coracao');
  await page.locator('#premiumResults button').first().click();
  await page.locator('#productDialog').waitFor({state:'visible'});
  await page.locator('#productDialogContent .order-primary').click();
  assert.equal(await page.locator('#openCart').isVisible(),true);
  await page.locator('#openCart').click();
  await page.locator('#startCheckout').click();
  await page.locator('#sendOrder').click();
  assert.match(await page.locator('#orderStatus').textContent(),/DEMONSTRAÇÃO: pedido simulado/);
  assert.equal(await page.locator('#localPartners').isVisible(),true);
  await page.locator('#cartBack').click();
  await page.locator('.cart-remove').first().click();
  assert.equal(await page.locator('#openCart').isVisible(),false);
  await page.locator('#cartBack').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
  await page.goto(base+'/?xtl_demo_loja=fechada');
  await page.waitForFunction(()=>window.storeOperationStatus?.open===false&&!window.storeOperationStatus?.unknown);
  await page.locator('#dismissStoreClosed').click();
  assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('store-lights-off')),true);
  assert.equal(await page.locator('#openCart').isVisible(),false);
  assert.equal(await page.locator('.hero-controls').isVisible(),false);
  assert.equal(await page.locator('a.whatsapp-float').isVisible(),false);
  assert.equal(await page.locator('.category-card').first().isVisible(),true);
  assert.deepEqual(mutations,[]);
  assert.deepEqual(errors,[]);
  fs.mkdirSync('artifacts/premium',{recursive:true});
  await page.screenshot({path:'artifacts/premium/closed-'+viewport.width+'.png',fullPage:true});
  await page.goto(base+'/?xtl_demo_loja=aberta');
  await page.locator('.category-card').first().waitFor();
  await page.screenshot({path:'artifacts/premium/open-'+viewport.width+'.png',fullPage:true});
  await ctx.close();
  console.log('PASS chromium '+viewport.width+': slider, pausa, busca, ficha, carrinho, checkout simulado, parceiros, fechamento, nenhum POST ou erro JS');
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
