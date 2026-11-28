'use strict';
const assert=require('node:assert/strict');
const x=require('../lib/lite-admin');
assert.equal(x.allowedRole('manager'),true);assert.equal(x.allowedRole('admin'),true);
for(const r of ['attendant','kitchen','courier',''])assert.equal(x.allowedRole(r),false);
for(const a of ['dashboard','customers','orders','delivery_map','store_operations','account_history'])assert.equal(x.allowedAction('GET',a),true);
for(const a of ['comandas','live_bi','operational_queue','management_reports'])assert.equal(x.allowedAction('GET',a),false);
assert.equal(x.allowedAction('POST','order_status'),true);assert.equal(x.allowedAction('POST','operational_status'),false);
console.log('lite-admin: permissões e allowlist OK');
