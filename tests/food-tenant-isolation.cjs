'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {isSharedFoodDatabase,assertNoGlobalSecretOnShared,
  FoodCredentialScopeError,SHARED_XTL_REF}=require('../lib/food-db-policy');
const {initLedger,OrderLedgerUnavailable}=require('../lib/order-idempotency');
const {initReviewStore,ReviewUnavailable}=require('../lib/order-review');
const {loadStoreStatus,StoreStatusUnavailable}=require('../lib/store-hours-source');
const migration=fs.readFileSync('supabase/migrations/202611180001_xtl_food_scoped_runtime.sql','utf8');
(async()=>{
  assert.equal(isSharedFoodDatabase({SUPABASE_URL:'https://'+SHARED_XTL_REF+'.supabase.co'}),true);
  assert.equal(isSharedFoodDatabase({SUPABASE_PROJECT_REF:SHARED_XTL_REF}),true);
  assert.equal(isSharedFoodDatabase({FOOD_DB_TOPOLOGY:'shared'}),true);
  assert.equal(isSharedFoodDatabase({XTL_SHARED_SUPABASE:'true'}),true);
  assert.equal(isSharedFoodDatabase({SUPABASE_URL:'https://example.supabase.co'}),false);
  assert.throws(()=>assertNoGlobalSecretOnShared({SUPABASE_URL:'https://'+SHARED_XTL_REF+'.supabase.co'}),
    FoodCredentialScopeError);
  const previous={...process.env};
  try {
    Object.assign(process.env,{
      ORDER_LEDGER_MODE:'required',ORDER_APPROVAL_MODE:'required',STORE_HOURS_MODE:'required',
      SUPABASE_URL:'https://'+SHARED_XTL_REF+'.supabase.co',
      SUPABASE_SECRET_KEY:'not-a-real-secret'
    });
    assert.throws(()=>initLedger(),OrderLedgerUnavailable);
    assert.throws(()=>initReviewStore(),ReviewUnavailable);
    await assert.rejects(()=>loadStoreStatus(),StoreStatusUnavailable);
    process.env.FOOD_DB_TOPOLOGY='shared';
    process.env.SUPABASE_URL='https://future-db.supabase.co';
    assert.throws(()=>initLedger(),OrderLedgerUnavailable);
    process.env.FOOD_DB_TOPOLOGY='dedicated';
    assert.doesNotThrow(()=>assertNoGlobalSecretOnShared(process.env));
  } finally {
    for(const k of ['ORDER_LEDGER_MODE','ORDER_APPROVAL_MODE','STORE_HOURS_MODE',
      'SUPABASE_URL','SUPABASE_SECRET_KEY','FOOD_DB_TOPOLOGY']){
      if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];
    }
  }
  assert.match(migration,/create role xtl_food_runtime nologin nobypassrls/i);
  assert.match(migration,/food_review_terminal_decision_complete_chk/);
  assert.match(migration,/for update to xtl_food_runtime/i);
  assert.doesNotMatch(migration,/grant .*xtl_people.*xtl_food_runtime/i);
  console.log('PASS XTL Food: block global keys in shared database; scoped NOLOGIN/RLS migration');
})().catch(e=>{console.error(e);process.exitCode=1});
