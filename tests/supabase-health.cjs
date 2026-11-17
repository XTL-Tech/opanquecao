const assert = require('node:assert/strict');
const handler = require('../api/health/supabase');

const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY
};
const fetchOriginal = global.fetch;

const makeRes = () => ({
    headers: {},
    setHeader(key,value){this.headers[key.toLowerCase()]=value},
    status(code){this.statusCode=code;return this},
    json(body){this.body=body;return this}
});
(async()=>{
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    let r=makeRes();
    await handler({method:'GET'},r);
    assert.equal(r.statusCode,503);
    assert.equal(r.body.status,'not_configured');
    assert.match(r.headers['cache-control'],/no-store/);
    r=makeRes();
    await handler({method:'POST'},r);
    assert.equal(r.statusCode,405);

    process.env.SUPABASE_URL='https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
    let count=0,lastUrl,lastHeaders;
    global.fetch=async(url,opts)=>{
        count++;
        lastUrl=url;
        lastHeaders=opts.headers;
        assert.equal(opts.cache,'no-store');
        return {ok:true,json:async()=>[{restaurant_id:'opanquecao'}]};
    };
    r=makeRes();await handler({method:'GET'},r);
    assert.equal(r.statusCode,200);
    assert.equal(r.body.status,'catalog_online');
    assert.equal(count,1);
    assert.match(lastUrl,/rest\/v1\/restaurant_catalogs/);
    assert.equal(lastHeaders.apikey,'sb_publishable_test');

    global.fetch=async()=>({ok:true,json:async()=>[]});
    r=makeRes();await handler({method:'GET'},r);
    assert.equal(r.statusCode,503);
    assert.equal(r.body.status,'catalog_missing');

    global.fetch=async()=>({ok:false,status:503});
    r=makeRes();await handler({method:'GET'},r);
    assert.equal(r.statusCode,503);
    assert.equal(r.body.status,'database_unavailable');

    global.fetch=async()=>{throw new Error('network unavailable')};
    r=makeRes();await handler({method:'GET'},r);
    assert.equal(r.statusCode,503);
    assert.equal(r.body.status,'database_unavailable');
    console.log('PASS: monitor Supabase, acesso ao catalogo, cache desativado, 503 em falha, sem segredos na resposta.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
    global.fetch=fetchOriginal;
    for(const [key,value] of Object.entries(env)){
        if(value===undefined) delete process.env[key];
        else process.env[key]=value;
    }
});
