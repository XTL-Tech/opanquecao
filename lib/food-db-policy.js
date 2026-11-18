'use strict';
// Never use a global Supabase service-role key from a company-scoped Food app.
const SHARED_XTL_REF='oksafggcaotekrvwvqgg';
class FoodCredentialScopeError extends Error {
  constructor(){super('Banco compartilhado exige credencial restrita XTL Food.');this.name='FoodCredentialScopeError';}
}
function isSharedFoodDatabase(env=process.env){
  if(env.FOOD_DB_TOPOLOGY==='shared'||env.XTL_SHARED_SUPABASE==='true'||env.SUPABASE_PROJECT_REF===SHARED_XTL_REF)return true;
  try{return new URL(env.SUPABASE_URL).hostname.toLowerCase()===SHARED_XTL_REF+'.supabase.co';}
  catch{return false;}
}
function assertNoGlobalSecretOnShared(env=process.env){
  if(isSharedFoodDatabase(env))throw new FoodCredentialScopeError();
}
module.exports={SHARED_XTL_REF,FoodCredentialScopeError,isSharedFoodDatabase,assertNoGlobalSecretOnShared};
