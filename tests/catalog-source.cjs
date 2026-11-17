const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadCatalog,CatalogUnavailableError}=require('../lib/catalog-source');
const api=require('../api/catalog');
const originalFetch=global.fetch;
const previous={};
for(const key of ['CATALOG_SOURCE','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'])previous[key]=process.env[key];
const makeRes=()=>({
    headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},
    status(n){this.code=n;return this},
    json(body){this.body=body;return this},
    end(){this.ended=true;return this}
});
(async()=>{
    const original=JSON.parse(fs.readFileSync(path.resolve('cardapio.json'),'utf8'));
    delete process.env.CATALOG_SOURCE;
    const legacy=await loadCatalog();
    assert.deepEqual(legacy,original);
    let res=makeRes();
    await api({method:'GET'},res);
    assert.equal(res.code,307);
    assert.equal(res.headers.location,'/cardapio.json');
    process.env.CATALOG_SOURCE='supabase';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    await assert.rejects(()=>loadCatalog(),CatalogUnavailableError);
    res=makeRes();await api({method:'GET'},res);
    assert.equal(res.code,503);

    process.env.SUPABASE_URL='https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
    let count=0;
    global.fetch=async(url,options)=>{
        count++;
        assert.match(url,/rest\/v1\/restaurant_catalogs/);
        assert.equal(options.cache,'no-store');
        assert.equal(options.headers.apikey,'sb_publishable_test');
        return {ok:true,json:async()=>[{catalog:original}]};
    };
    const fromDb=await loadCatalog();
    assert.equal(fromDb.categorias.length,12);
    assert.equal(fromDb.categorias.reduce((n,c)=>n+c.itens.length,0),82);
    assert.equal(count,1);
    res=makeRes();await api({method:'GET'},res);
    assert.equal(res.code,200);
    assert.deepEqual(res.body,original);
    global.fetch=async()=>({ok:false,status:503});
    await assert.rejects(()=>loadCatalog(),CatalogUnavailableError);
    res=makeRes();await api({method:'GET'},res);
    assert.equal(res.code,503);
    console.log('PASS: Supabase como fonte unica, fallback original sem chave e falha segura durante indisponibilidade.');
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>{
    global.fetch=originalFetch;
    for(const [k,v] of Object.entries(previous)){
        if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
});
