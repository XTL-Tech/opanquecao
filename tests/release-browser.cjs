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
  const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
  const page=await ctx.newPage(),errors=[],mutations=[];
  let open=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==base)return route.abort();
   if(req.method()!=='GET'){mutations.push(url.pathname);return route.abort();}
   if(url.pathname==='/api/catalog')return route.fulfill({json:catalog});
   if(url.pathname==='/api/store-status')return route.fulfill({json:{enabled:true,open,reason:open?'open':'outside_hours',date:'2026-11-26',canSubscribe:false}});
   if(url.pathname==='/api/customer-account')return route.fulfill({status:401,json:{error:'Entre na sua conta.'}});
   if(url.pathname==='/api/order-config')return route.fulfill({json:{siteKey:null,testMode:true}});
   return route.continue();
  });
  await page.goto(base+'/');
  await page.locator('.category-card').first().waitFor();
  await page.waitForFunction(()=>window.storeOperationStatus?.open===true);
  assert.equal(await page.locator('.category-card').count(),12);
  assert.equal(await page.locator('#openCart').isVisible(),false);
  assert.equal(await page.locator('a.whatsapp-float').isVisible(),true);
  assert.equal(await page.locator('#heroDots button').count(),4);
  const active=await page.locator('#heroDots [aria-current=true]').getAttribute('aria-label');
  await page.locator('#heroNext').click();
  assert.notEqual(await page.locator('#heroDots [aria-current=true]').getAttribute('aria-label'),active);
  await page.locator('#heroPrev').click();
  assert.equal(await page.locator('#heroDots [aria-current=true]').getAttribute('aria-label'),active);
  await page.locator('#heroPause').click();
  for(const category of catalog.categorias){
   await page.locator('.category-card[href="#'+category.id+'"]').click();
   assert.equal(await page.locator('#'+category.id).isVisible(),true);
   await page.locator('#categoryToolbar > a[href="#cardapio"]').click();
  }
  await page.locator('#premiumSearch').fill('coracao');
  await page.locator('#premiumResults button').first().click();
  await page.locator('#productDialog').waitFor({state:'visible'});
  await page.locator('#productDialog form[method=dialog] button').click();
  assert.equal(await page.locator('#productDialog').isVisible(),false);
  assert.equal(await page.locator('[data-partner-slot]').count(),3);
  await page.locator('.site-tabs a[href="#contato"]').click();
  await page.locator('.site-tabs a[href="#como-chegar"]').click();
  await page.locator('.site-tabs a[href="#cardapio"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
  open=false;
  await page.reload();
  await page.waitForFunction(()=>window.storeOperationStatus?.open===false&&!window.storeOperationStatus?.unknown);
  if(await page.locator('#storeClosedDialog').isVisible())await page.locator('#dismissStoreClosed').click();
  assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('store-lights-off')),true);
  assert.equal(await page.locator('#openCart').isVisible(),false);
  assert.equal(await page.locator('a.whatsapp-float').isVisible(),false);
  assert.equal(await page.locator('.hero-controls').isVisible(),false);
  // On the closed entrance, dim only the hero/header, never the menu itself.
  await page.goto(base+'/');
  await page.waitForFunction(()=>window.storeOperationStatus?.open===false&&!window.storeOperationStatus?.unknown);
  if(await page.locator('#storeClosedDialog').isVisible())await page.locator('#dismissStoreClosed').click();
  await page.locator('.category-card').first().waitFor();
  assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('menu-browsing')),false);
  assert.match(await page.locator('.premium-hero').evaluate(e=>getComputedStyle(e).filter),/grayscale/);
  assert.equal(await page.locator('main').evaluate(e=>getComputedStyle(e).filter),'none');
  await page.locator('#premiumCta').click();
  assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('menu-browsing')),true);
  assert.equal(await page.locator('.premium-hero').evaluate(e=>getComputedStyle(e).filter),'none');
  await page.locator('.category-card[href="#bebidas"]').click();
  assert.equal(await page.locator('#bebidas').isVisible(),true);
  assert.equal(await page.locator('#bebidas .item-photo img').first().evaluate(e=>getComputedStyle(e).filter),'none');
  assert.equal(await page.locator('#bebidas .quick-add').first().isVisible(),false);
  assert.equal(await page.locator('a.whatsapp-float').isVisible(),false);
  await page.reload();
  await page.waitForFunction(()=>window.storeOperationStatus?.open===false&&!window.storeOperationStatus?.unknown);
  assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('menu-browsing')),true);
  assert.equal(await page.locator('#storeClosedDialog').isVisible(),false);
  assert.equal(await page.locator('#openCart').isVisible(),false);
  assert.deepEqual(mutations,[]);
  assert.deepEqual(errors,[]);
  await ctx.close();
  console.log('PASS chromium '+viewport.width+': categories, navigation, slider, search, product modal, closed mode, no real requests');
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
