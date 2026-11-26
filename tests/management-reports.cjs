'use strict';
const assert=require('node:assert/strict');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const {report,windowFor}=require('../lib/management-reports');
const handler=require('../api/backoffice');
const today=require('../lib/backoffice-core').businessDate();
const queries=[];
db.run=async(sql,params)=>{queries.push({sql,params});return[];};
db.configured=()=>true;auth.configured=()=>true;
const res=()=>({code:0,setHeader(){},status(n){this.code=n;return this},json(b){this.body=b;return this}});
async function request(role){auth.actor=async()=>({id:'staff',role});const r=res();await handler({method:'GET',query:{action:'management_reports',start:today,end:today}},r);return r;}
(async()=>{
 assert.deepEqual(windowFor(today,today),[today,today]);
 assert.throws(()=>windowFor('2020-01-01',today),e=>e.isValidation);
 for(const role of ['attendant','kitchen','courier']){queries.length=0;assert.equal((await request(role)).code,403);assert.equal(queries.length,0);}
 const manager=await request('manager');assert.equal(manager.code,200);assert.equal(manager.body.technical,undefined);
 assert.ok(queries.some(x=>x.sql.includes("settled_business_date BETWEEN")&&x.sql.includes("payment_status='paid'")));
 assert.ok(queries.some(x=>x.sql.includes('jsonb_array_elements(items)')));
 assert.ok(queries.every(x=>!x.sql.includes('s.email')));
 queries.length=0;const admin=await request('admin');assert.equal(admin.code,200);assert.ok(admin.body.technical);
 assert.ok(queries.some(x=>x.sql.includes('dp.order_events')));
 assert.ok(queries.some(x=>x.sql.includes('dp.cashback_config')));
 console.log('PASS management reports: permission isolation, bounded period, settlement cohort, technical audit.');
})().catch(e=>{console.error(e);process.exitCode=1;});
