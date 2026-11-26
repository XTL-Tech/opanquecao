'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const handler=require('../api/whatsapp-intent');
const {randomUUID}=require('node:crypto');
const {PDFDocument}=require('pdf-lib');
const response=()=>({code:0,setHeader(k,v){if(k==='Cache-Control')assert.equal(v,'no-store')},
    status(code){this.code=code;return this},json(data){this.data=data;return this}});
const base={
    requestId:randomUUID(),name:'Cliente de teste',phone:'(51) 99999-9999',
    lines:[{category:'bebidas',product:'Coca-Cola Lata',option:'Único',quantity:2,note:'',
        flavors:[],freeExtras:[],paidExtras:[],cents:1}],
    note:'Separar para retirada',challenge:'token-ficticio',fulfillment:{type:'pickup'}
};
Object.assign(process.env,{
    VERCEL_ENV:'preview',TELEGRAM_BOT_TOKEN:'fake-token',
    TELEGRAM_CHAT_ID:'fake-chat',TURNSTILE_SECRET_KEY:'fake-secret'
});
delete process.env.STORE_HOURS_MODE;
let checks=0,alerts=0,documents=0,valid=true,action='order_intent',hostname='opanquecao.vercel.app';
let sent,receipt,available=true,documentAvailable=true;
global.fetch=async(url,init)=>{
    if(url.endsWith('/siteverify')){
        checks++;
        assert.equal(init.method,'POST');
        assert.equal(init.body.get('secret'),'fake-secret');
        return {ok:true,json:async()=>({success:valid,action,hostname})};
    }
    if(url.endsWith('/sendMessage')){
        alerts++;
        throw new Error('Não enviar texto separado');
    }
    if(url.endsWith('/sendDocument')){
        documents++;
        assert.equal(init.method,'POST');
        assert.equal(init.headers,undefined,'Multipart FormData determina Content-Type com boundary');
        assert.equal(init.body.get('chat_id'),'fake-chat');
        assert.equal(init.body.get('reply_to_message_id'),null);
        const button=JSON.parse(init.body.get('reply_markup')).inline_keyboard[0][0];
        assert.equal(button.text,'💬 Confirmar pedido com cliente');
        assert.match(button.url,/^https:\/\/wa\.me\/5551999999999\?text=/);
        const file=init.body.get('document');
        assert.equal(file.type,'application/pdf');
        assert.match(file.name,/^TESTE-NAO-PREPARAR-[A-F0-9]{8}-cupom-termico\.pdf$/);
        const bytes=new Uint8Array(await file.arrayBuffer());
        assert.ok(bytes.length>1000,'O cupom não pode ser vazio');
        const pdf=await PDFDocument.load(bytes);
        assert.ok(pdf.getPageCount()>=1,'PDF válido com pelo menos uma página');
        assert.ok(Math.abs(pdf.getPage(0).getWidth()-58*72/25.4)<0.15,
            'Largura padrão deve ser 58 mm');
        receipt={caption:init.body.get('caption'),bytes,pdf};
        assert.equal(receipt.caption,'🧪 TESTE — NÃO PREPARAR!\n🔔 NOVO PEDIDO\nAguardando confirmação pelo WhatsApp.');
        return {ok:documentAvailable,json:async()=>({ok:documentAvailable,result:{message_id:101}})};
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
    assert.equal(result.code,405); assert.equal(alerts,0);assert.equal(documents,0);
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
    assert.equal(result.data.test,true);assert.equal(alerts,0);assert.equal(documents,1);
    assert.doesNotMatch(receipt.caption,/Cliente de teste|Coca-Cola|R\$/);
    if (process.env.CI) {
        fs.mkdirSync('artifacts/thermal',{recursive:true});
        fs.writeFileSync('artifacts/thermal/cupom-58mm-ficticio.pdf',receipt.bytes);
    }
    const delivery = {type:'delivery',city:'Nova Hartz',neighborhood:'Centro',
        street:'Rua das Flores',number:'123',complement:'Casa 2',reference:'Portão azul',
        latitude:-29.585,longitude:-50.938};
    result=await run({...base,fulfillment:delivery,requestId:randomUUID()});
    assert.equal(result.code,201);
    assert.doesNotMatch(receipt.caption,/Rua das Flores|Centro|Portão azul|R\$/);
    const beforeInvalid=alerts;
    result=await run({...base,fulfillment:{...delivery,number:''},requestId:randomUUID()});
    assert.equal(result.code,400);assert.equal(alerts,beforeInvalid);
    result=await run({...base,fulfillment:{...delivery,neighborhood:'Bairro inexistente'},requestId:randomUUID()});
    assert.equal(result.code,400);assert.equal(alerts,beforeInvalid);
    result=await run({...base,fulfillment:{...delivery,latitude:999},requestId:randomUUID()});
    assert.equal(result.code,400);assert.equal(alerts,beforeInvalid);
    result=await run({...base,fulfillment:{type:'table',table:'Mesa 03'},requestId:randomUUID()});
    assert.equal(result.code,201);
    assert.doesNotMatch(receipt.caption,/Mesa 03|CPF|Localização GPS/);
    result=await run({...base,fulfillment:{type:'table',table:''},requestId:randomUUID()});
    assert.equal(result.code,400);
    // Se o envio do PDF falhar, não marcar como registrado
    // nem tentar reenviar automaticamente (evita mensagens duplicadas).
    documentAvailable=false;
    const beforePdfFailure=alerts,docsBeforePdfFailure=documents;
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,202);assert.equal(result.data.pending,true);
    assert.match(result.data.error,/não foi possível confirmar o cupom/i);
    assert.equal(alerts,beforePdfFailure);
    assert.equal(documents,docsBeforePdfFailure+1);
    documentAvailable=true;
    delete process.env.TURNSTILE_SECRET_KEY;
    result=await run({...base,requestId:randomUUID()});
    assert.equal(result.code,503);
    console.log('PASS: alerta único com PDF térmico 58mm e botão WhatsApp, sem dados na legenda, proteção Turnstile e falha incerta.');
})().catch(e=>{console.error(e);process.exitCode=1});
