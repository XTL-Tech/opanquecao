'use strict';
const assert=require('node:assert/strict');
const send=require('../api/wa-hml-send');
const variables=['WA_HML_TRIGGER_KEY','WA_HML_ACCESS_TOKEN','WA_HML_PHONE_NUMBER_ID','WA_HML_TEST_RECIPIENT','WA_HML_GRAPH_VERSION'];
const originalVars=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
const originalFetch=global.fetch;
const originalInfo=console.info;
function response(){
  const res={code:200,body:null,headers:{}};
  res.setHeader=(k,v)=>{res.headers[k.toLowerCase()]=v;};
  res.status=code=>{res.code=code;return res;};
  res.json=data=>{res.body=data;return res;};
  return res;
}
const key='this-is-an-internal-test-key-that-is-long-enough';
const req=(type,pass=key,extras={})=>({
  method:'POST',headers:{'x-xtl-wa-hml-key':pass},body:{type,...extras}
});
(async()=>{
  try{
    for(const k of variables)delete process.env[k];
    let res=response();await send(req('hello_world'),res);
    assert.equal(res.code,503);
    process.env.WA_HML_TRIGGER_KEY=key;
    process.env.WA_HML_ACCESS_TOKEN='fake-token-do-not-use';
    process.env.WA_HML_PHONE_NUMBER_ID='12345678901234';
    process.env.WA_HML_TEST_RECIPIENT='5551999999999';
    process.env.WA_HML_GRAPH_VERSION='v26.0';
    const requests=[];
    global.fetch=async(url,opts)=>{
      requests.push({url,opts});
      return {ok:true,status:200,json:async()=>({messages:[{id:'wamid.test-send'}]})};
    };
    console.info=()=>{};
    res=response();await send(req('hello_world','wrong'),res);
    assert.equal(res.code,403);
    assert.equal(requests.length,0,'Never send without valid trigger key');
    res=response();await send(req('bogus'),res);
    assert.equal(res.code,400);
    res=response();await send(req('hello_world'),res);
    assert.equal(res.code,202);
    assert.equal(res.body.acceptedByMeta,true);
    assert.equal(res.body.delivered,false);
    assert.equal(requests.length,1);
    let payload=JSON.parse(requests[0].opts.body);
    assert.equal(payload.to,'5551999999999');
    assert.equal(payload.template.name,'hello_world');
    assert.equal(requests[0].url,'https://graph.facebook.com/v26.0/12345678901234/messages');
    res=response();await send(req('order',key,{to:'5500000000000',text:'injected'}),res);
    assert.equal(res.code,202);
    assert.match(res.body.testMarker,/^XTL-HML-\d{8}-[A-F0-9]{12}$/);
    payload=JSON.parse(requests[1].opts.body);
    assert.equal(payload.to,'5551999999999','User input must never override test recipient');
    assert.match(payload.text.body,/TESTE — NÃO PREPARAR/);
    assert.match(payload.text.body,/1\. 1x Panqueca Bacon - Tam\.: G - Obs\.: sem cebola/);
    assert.match(payload.text.body,new RegExp(res.body.testMarker));
    assert.equal(payload.text.body.includes('injected'),false);
    assert.equal(JSON.stringify(res.body).includes('fake-token-do-not-use'),false);
    assert.equal(JSON.stringify(res.body).includes('5551999999999'),false);
    global.fetch=async()=>({ok:false,status:400,json:async()=>({error:{code:131000,message:'secret detail'}})});
    res=response();await send(req('hello_world'),res);
    assert.equal(res.code,502);
    assert.equal(res.body.providerCode,131000);
    assert.equal(JSON.stringify(res.body).includes('secret detail'),false);
    global.fetch=async()=>{throw new Error('network');};
    res=response();await send(req('hello_world'),res);
    assert.equal(res.code,502);
    process.env.WA_HML_GRAPH_VERSION='http://malicious';
    res=response();await send(req('hello_world'),res);
    assert.equal(res.code,503);
    console.log('PASS: HML WhatsApp send with allowlisted recipient, secret, API error handling and no PII leakage.');
  }finally{
    global.fetch=originalFetch;console.info=originalInfo;
    for(const [k,v]of Object.entries(originalVars)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});