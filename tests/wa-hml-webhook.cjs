'use strict';
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Readable } = require('node:stream');
const handler = require('../api/wa-hml-webhook');

function request(method, url, body = '', headers = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}
function response() {
  const out = {code: 200, headers: {}, body: null};
  out.status = status => { out.code = status; return out; };
  out.setHeader = (key, value) => { out.headers[key.toLowerCase()] = value; };
  out.send = value => { out.body = value; return out; };
  return out;
}
(async () => {
  const previousVerify = process.env.WA_HML_VERIFY_TOKEN;
  const previousApp = process.env.WA_HML_APP_SECRET;
  process.env.WA_HML_VERIFY_TOKEN = 'fake-verify-token-strong';
  process.env.WA_HML_APP_SECRET = 'fake-app-secret-strong';
  try {
    let res = response();
    await handler(request('GET','/api/wa-hml-webhook?hub.mode=subscribe&hub.challenge=123456&hub.verify_token=fake-verify-token-strong'),res);
    assert.equal(res.code,200);
    assert.equal(res.body,'123456');
    assert.equal(res.headers['cache-control'],'no-store');
    res=response();
    await handler(request('GET','/api/wa-hml-webhook?hub.mode=subscribe&hub.challenge=123456&hub.verify_token=wrong'),res);
    assert.equal(res.code,403);
    res=response();
    await handler(request('GET','/api/wa-hml-webhook?hub.mode=subscribe&hub.challenge=%3Cscript%3E&hub.verify_token=fake-verify-token-strong'),res);
    assert.equal(res.code,403);
    const event = {
      object:'whatsapp_business_account',
      entry:[{changes:[{field:'messages',value:{
        contacts:[{profile:{name:'PERSONAL-NAME'},wa_id:'51912345678'}],
        messages:[{id:'wamid.test.123',from:'51912345678',type:'text',text:{body:'XTL-HML-20261118-ABCD Segredo não registrar'}}],
        statuses:[{id:'wamid.test.456',status:'delivered',recipient_id:'51912345678'}]
      }}]}]
    };
    const body=JSON.stringify(event);
    const signature='sha256='+createHmac('sha256',process.env.WA_HML_APP_SECRET).update(body).digest('hex');
    assert.equal(handler.verifySignature(Buffer.from(body),signature,process.env.WA_HML_APP_SECRET),true);
    assert.equal(handler.verifySignature(Buffer.from(body),signature+'x',process.env.WA_HML_APP_SECRET),false);
    const summaries = handler.summarizeEvent(event);
    assert.equal(summaries.length,2);
    assert.equal(summaries[0].testMarker,'XTL-HML-20261118-ABCD');
    assert.equal(summaries[1].status,'delivered');
    assert.equal(JSON.stringify(summaries).includes('51912345678'),false);
    const logs=[];
    const original=console.info;
    console.info=line=>logs.push(line);
    try {
      res=response();
      await handler(request('POST','/api/wa-hml-webhook',body,{'x-hub-signature-256':signature}),res);
      assert.equal(res.code,200);
      assert.equal(logs.length,2);
      assert.equal(logs.join('').includes('PERSONAL-NAME'),false);
      assert.equal(logs.join('').includes('51912345678'),false);
      assert.equal(logs.join('').includes('Segredo'),false);
      res=response();
      await handler(request('POST','/api/wa-hml-webhook',body,{'x-hub-signature-256':'sha256=invalid'}),res);
      assert.equal(res.code,403);
      assert.equal(logs.length,2);
      res=response();
      await handler(request('POST','/api/wa-hml-webhook',body+' ',{'x-hub-signature-256':signature}),res);
      assert.equal(res.code,403,'Signature must cover exact raw bytes');
      res=response();
      await handler(request('POST','/api/wa-hml-webhook','{',{'x-hub-signature-256':'sha256='+createHmac('sha256',process.env.WA_HML_APP_SECRET).update('{').digest('hex')}),res);
      assert.equal(res.code,400);
      res=response();
      await handler(request('POST','/api/wa-hml-webhook','x'.repeat(262145),{'x-hub-signature-256':signature}),res);
      assert.equal(res.code,413);
      res=response();
      await handler(request('DELETE','/api/wa-hml-webhook'),res);
      assert.equal(res.code,405);
    } finally {console.info=original;}
    delete process.env.WA_HML_APP_SECRET;
    res=response();
    await handler(request('POST','/api/wa-hml-webhook',body,{'x-hub-signature-256':signature}),res);
    assert.equal(res.code,503,'Fail closed if secret missing');
    console.log('PASS: WhatsApp HML webhook verification, HMAC, incoming receipt, status and PII redaction.');
  } finally {
    if (previousVerify === undefined) delete process.env.WA_HML_VERIFY_TOKEN; else process.env.WA_HML_VERIFY_TOKEN=previousVerify;
    if (previousApp === undefined) delete process.env.WA_HML_APP_SECRET; else process.env.WA_HML_APP_SECRET=previousApp;
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });