'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const handler = require('../api/order.js');

function response() {
    return {
        code: 200, headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(code) { this.code = code; return this; },
        json(value) { this.body = value; return this; }
    };
}

(async () => {
    const { orderOptions } = await import(path.resolve('order-catalog.mjs'));
    const catalog = JSON.parse(fs.readFileSync(path.resolve('cardapio.json'), 'utf8'));
    const category = catalog.categorias.find(entry =>
        entry.itens.some(item => orderOptions(item).length));
    const product = category.itens.find(item => orderOptions(item).length);
    const item = { category: category.id, product: product.nome,
        option: orderOptions(product)[0].label, quantity: 1,
        note: '', freeExtras: [], paidExtras: [] };
    const secrets = {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'fake-server-only-secret',
        ORDER_LEDGER_MODE: 'required',
        TELEGRAM_BOT_TOKEN: 'fake-token',
        TELEGRAM_CHAT_ID: '-100123456789',
        TURNSTILE_SECRET_KEY: 'fake-turnstile-secret',
        VERCEL_ENV: 'preview',
        CATALOG_SOURCE: 'file'
    };
    Object.assign(process.env, secrets);
    const rows = new Map();
    let sent = 0;
    let accepted = true;
    let badJson = false;
    global.fetch = async (url, init = {}) => {
        if (url.includes('/siteverify')) {
            return {ok:true, json:async () => ({success:true})};
        }
        if (url.includes('/sendDocument')) {
            sent++;
            return {ok:accepted, json:async () => ({ok:accepted,result:{message_id:sent}})};
        }
        if (url.includes('/restaurant_order_intents')) {
            const endpoint = new URL(url);
            const method = init.method || 'GET';
            if (badJson) return {ok:true,json:async()=>({broken:true})};
            if (method === 'GET') {
                const id = endpoint.searchParams.get('request_id')?.slice(3);
                return {ok:true,json:async()=>rows.has(id)?[rows.get(id)]:[]};
            }
            if (method === 'POST') {
                const record = JSON.parse(init.body);
                const inserted = !rows.has(record.request_id);
                if (inserted) rows.set(record.request_id, record);
                return {ok:true,json:async()=>inserted?[record]:[]};
            }
            if (method === 'PATCH') {
                const id = endpoint.searchParams.get('request_id')?.slice(3);
                const current = rows.get(id);
                if (!current || current.status !== 'processing') {
                    return {ok:true,json:async()=>[]};
                }
                Object.assign(current, JSON.parse(init.body));
                return {ok:true,json:async()=>[current]};
            }
        }
        throw new Error('Unexpected external request');
    };
    const data = requestId => ({
        requestId, name:'Pessoa de teste', phone:'51999999999', challenge:'turnstile-test',
        lines:[item], payment:{method:'pix',changeForCents:null}, fulfillment:{type:'pickup',address:'',table:'',latitude:null,longitude:null}
    });
    const submit = async payload => {
        const res = response();
        await handler({method:'POST',body:payload},res);
        assert.equal(res.headers['cache-control'],'no-store');
        return res;
    };

    const key = randomUUID();
    let result = await submit(data(key));
    assert.equal(result.code,200);
    assert.equal(sent,1);
    assert.equal(rows.get(key).status,'delivered');

    result = await submit(data(key));
    assert.equal(result.code,200);
    assert.equal(result.body.replayed,true);
    assert.equal(sent,1,'Replay must never cause second Telegram message');
    result = await submit({...data(key),name:'Pedido diferente'});
    assert.equal(result.code,409);
    assert.equal(sent,1,'Changing payload with same key must be rejected');
    result = await submit({...data(key),payment:{method:'cash',changeForCents:null}});
    assert.equal(result.code,409);
    assert.equal(sent,1,'Changing payment with same key must be rejected');

    const uncertainKey=randomUUID();
    accepted=false;
    result=await submit(data(uncertainKey));
    assert.equal(result.code,202);
    assert.equal(result.body.pending,true);
    assert.equal(rows.get(uncertainKey).status,'needs_review');
    accepted=true;
    result=await submit(data(uncertainKey));
    assert.equal(result.code,202);
    assert.equal(sent,2,'Uncertain delivery must never be retried automatically');

    const raceKey=randomUUID();
    const before=sent;
    const [first,second]=await Promise.all([submit(data(raceKey)),submit(data(raceKey))]);
    assert.ok([200,202].includes(first.code));
    assert.ok([200,202].includes(second.code));
    assert.equal(sent,before+1,'Concurrent attempts must claim only once');

    const missing=randomUUID();
    const previousKey=process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    result=await submit(data(missing));
    assert.equal(result.code,503);
    assert.equal(sent,before+1,'Database outage must fail closed');
    process.env.SUPABASE_SECRET_KEY=previousKey;

    badJson=true;
    result=await submit(data(randomUUID()));
    assert.ok([503,502].includes(result.code),'Corrupt ledger response must be rejected');
    assert.equal(sent,before+1);
    badJson=false;

    const migration=fs.readFileSync(path.resolve('supabase/migrations/202611170003_order_intents.sql'),'utf8');
    assert.match(migration,/enable row level security/i);
    assert.match(migration,/primary key \(restaurant_id, request_id\)/i);
    assert.doesNotMatch(migration,/create policy .*anon/i);
    console.log('PASS: idempotency ledger, duplicate suppression, race, ambiguous timeout, fail-closed, RLS.');
})().catch(error=>{console.error(error);process.exitCode=1});
