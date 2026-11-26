'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const code=fs.readFileSync('store-hours-client.mjs','utf8');
async function sample(mode,demoAvailable=true){
  const w=new JSDOM(html,{url:'https://preview.vercel.app/?xtl_demo_loja='+mode,runScripts:'outside-only'}).window;
  const d=w.document;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.setInterval=()=>0;
  let calls=0;
  w.fetch=async path=>{
    assert.equal(path,'/api/store-status');
    calls++;
    return {ok:true,json:async()=>({enabled:false,open:true,demoAvailable,canSubscribe:false})};
  };
  w.eval(code);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  return {w,d};
}
(async()=>{
  const closed=await sample('fechada');
  assert.equal(closed.w.storeOperationStatus.enabled,true);
  assert.equal(closed.w.storeOperationStatus.simulated,true);
  assert.equal(closed.w.storeOperationStatus.open,false);
  assert.equal(closed.d.getElementById('storeClosedDialog').open,true);
  assert.equal(closed.d.documentElement.classList.contains('store-lights-off'),true);
  assert.equal(closed.d.getElementById('storeLightsStatus').hidden,false);
  assert.match(closed.d.getElementById('storeOpenStatus').textContent,/DEMONSTRAÇÃO.*fechada/);
  assert.match(closed.d.getElementById('storeAlertNote').textContent,/ainda não estão habilitados/);
  closed.d.getElementById('dismissStoreClosed').click();
  assert.equal(closed.d.getElementById('storeClosedDialog').open,false);
  const opened=await sample('aberta');
  assert.equal(opened.w.storeOperationStatus.open,true);
  assert.equal(opened.w.storeOperationStatus.simulated,true);
  assert.equal(opened.d.getElementById('storeClosedDialog').open,false);
  assert.equal(opened.d.documentElement.classList.contains('store-lights-off'),false);
  assert.equal(opened.d.getElementById('storeLightsStatus').hidden,true);
  assert.match(opened.d.getElementById('storeOpenStatus').textContent,/DEMONSTRAÇÃO.*aberta/);
  const prod=await sample('fechada',false);
  assert.equal(prod.w.storeOperationStatus.enabled,false);
  assert.equal(prod.d.getElementById('storeOpenStatus').hidden,true);
  assert.equal(prod.d.getElementById('storeClosedDialog').open,false);
  assert.equal(prod.d.documentElement.classList.contains('store-lights-off'),false);
  console.log('PASS: Preview demo closed/open UI, no false notifications, production demo disabled');
})().catch(error=>{console.error(error);process.exitCode=1});
