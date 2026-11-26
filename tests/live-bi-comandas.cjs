'use strict';
const assert=require('node:assert/strict');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const tabs=require('../lib/comandas');
const bi=require('../lib/live-bi');
const api=require('../api/backoffice');
const id='11111111-1111-4111-8111-111111111111';
const actor={id:'staff',role:'attendant'};
const fakeCpf='52998224725'; // checksum fixture, never sent to any external service
process.env.COMANDA_CPF_HMAC_KEY='ab'.repeat(32);
let sql,params,rows=[];
db.run=async(s,p)=>{sql=s;params=p;return rows;};
db.configured=()=>true;auth.configured=()=>true;auth.originGuard=()=>{};
const res=()=>({code:0,setHeader(){},status(n){this.code=n;return this},json(b){this.body=b;return this}});
(async()=>{
 assert.equal(tabs.cpf('529.982.247-25'),fakeCpf);
 assert.throws(()=>tabs.cpf('11111111111'),e=>e.isValidation);
 assert.throws(()=>tabs.cpf('52998224726'),e=>e.isValidation);
 assert.match(tabs.keyFor(fakeCpf),/^[a-f0-9]{64}$/);
 rows=[{id,table_number:2}];
 await tabs.open(actor,{cpf:fakeCpf,table:2,name:'Cliente fictício',phone:'10000000000'});
 assert.equal(params[2],tabs.keyFor(fakeCpf));assert.equal(params[3],'25');assert.ok(!params.includes(fakeCpf));
 await tabs.find(actor,{cpf:fakeCpf});assert.deepEqual(params,[tabs.keyFor(fakeCpf)]);
 await assert.rejects(tabs.list({role:'kitchen'}),e=>e.status===403);
 await assert.rejects(bi.live(actor),e=>e.status===403);
 rows=[{id:null}];await assert.rejects(tabs.close(actor,{id}),e=>e.status===409);
 rows=[{totals:{orders:1},occupied_tables:1}];const live=await bi.live({role:'manager'});assert.equal(live.occupied_tables,1);assert.match(sql,/occupied_tables/);assert.doesNotMatch(sql,/cpf_key|customer_phone|customer_name/);
 for(const role of ['attendant','kitchen','courier']){auth.actor=async()=>({role});const r=res();await api({method:'GET',query:{action:'live_bi'}},r);assert.equal(r.code,403);}
 console.log('PASS live BI and comandas: CPF validation, keyed lookup, protected role boundaries and aggregate TV data.');
})().catch(e=>{console.error(e);process.exitCode=1;});
