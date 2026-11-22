'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const handler=require('../api/whatsapp-intent');
const {randomUUID}=require('node:crypto');
const response=()=>({code:0,setHeader(k,v){if(k==='Cache-Control')assert.equal(v,'no-store')},
    status(code){this.code=code;return this},json(data){this.data=data;return this}});
const base={
    requestId:randomUUID(),name:'Cliente de teste',phone:'(51) 99999-9999',
    lines:[{category:'bebidas',product:'Coca-Cola Lata',option:'Único',quantity:2,note:'',
        flavors:[],freeExtras:[],paidExtras:[],cents:1}],
    note:'Separar para retirada',challenge:'token-ficticio'
};
Object.assign(process.env,{
    VERCEL_ENV:'preview',TELEGRAM_BOT_TOKEN:'fake-token',
    TELEGRAM_CHAT_ID:'fake-chat',TURNSTILE_SECRET_KEY:'fake-secret'
});
delete process.env.STORE_HOURS_MODE;
let checks=0,alerts=0,valid=true,action='order_intent',hostname='opanquecao.vercel.app';
let sent,available=true;
global.fetch=async(url,init)=>{
    if(url.endsWith('/siteverify')){
        checks++;
        assert.equal(init.method,'POST');
        assert.equal(init.body.get('secret'),'fake-secret');
        return {ok:true,json:async()=>({success:valid,action,hostname})};
    }
    if(url.endsWith('/sendMessage')){
        alerts++;
        sent=JSON.parse(init.body);
        assert.equal(sent.chat_id,'fake-chat');
        assert.equal(sent.reply_markup.inline_keyboard[0][0].text,'💬 Chamar cliente no WhatsApp');
        assert.match(sent.reply_markup.inline_keyboard[0][0].url,/^https:\/\/wa\.me\/5551999999999\?text=/);
        return {ok:available,json:async()=>({ok:available,result:{message_id:100}})};
    }
    throw new Error('Unexpected URL '+url);
};
const run=async(payload=base,method='POST',host='opanquecao.vercel.app')=>{
    const out=response();
    await handler({method,headers:{host},body:payload},out);
    return out;
};
(async()=>{
    let result=await run({},'GET');
    assert.equal(result.code,405); assert.equal(alerts,0);
    result=await run({...base,name:'',requestId:randomUUID()});
    assert.equal(result.code,400);assert.equal(checks,0);
    result=await run({...base,phone:'123',requestId:randomUUID()});
    assert.equal(result.code,400);assert.equal(checks,0);
    result=await run({...base,lines:[{...base.lines[0],quantity:999}],requestId:randomUUID()});
    assert.equal(result.code,400);assert.equal(checks,0);
    valid=false;
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,403);assert.equal(alerts,0);
    valid=true;action='login';
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,403);assert.equal(alerts,0);
    action='order_intent';hostname='evil.example';
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,403);assert.equal(alerts,0);
    hostname='opanquecao.vercel.app';
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,201);assert.equal(result.data.status,'registered');
    assert.equal(result.data.test,true);assert.equal(alerts,1);
    assert.match(sent.text,/TESTE — NÃO PREPARAR/);
    assert.match(sent.text,/NÃO É PEDIDO CONFIRMADO/);
    assert.match(sent.text,/Cliente de teste/);
    assert.match(sent.text,/Coca-Cola Lata/);
    assert.match(sent.text,/R\$\s*12,00/); // Valor recalculado pelo catálogo, nunca usa cents:1
    assert.doesNotMatch(sent.text,/R\$\s*0,02/);
    available=false;
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,202);assert.equal(result.data.pending,true);
    assert.match(result.data.error,/pode ter chegado/);
    available=true;
    delete process.env.TURNSTILE_SECRET_KEY;
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,503);
    console.log('PASS: bot registra referência, nome, WhatsApp, preço do servidor, proteção Turnstile e estado incerto.');
})().catch(e=>{console.error(e);process.exitCode=1});
