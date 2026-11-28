'use strict';
const { resolveStoreStatus } = require('./store-hours');
class StoreStatusUnavailable extends Error {}
function enforced() { return process.env.STORE_HOURS_MODE === 'required'; }
async function loadStoreStatus(now = new Date()) {
  if (!enforced()) return {enabled:false,open:true,reason:'legacy_mode'};
  if(process.env.STORE_HOURS_SOURCE==='neon'){
    try{
      const db=require('./backoffice-neon');
      const rows=await db.run("SELECT restaurant_id,time_zone,accepting_orders,enforce_opening_hours,weekly_schedule,holiday_exceptions,manual_state,manual_override_until FROM dp.store_operations WHERE restaurant_id='opanquecao'");
      if(rows.length!==1)throw Error('Agenda ainda não cadastrada');
      return {enabled:true,...resolveStoreStatus(rows[0],now),weeklySchedule:rows[0].weekly_schedule};
    }catch{throw new StoreStatusUnavailable('Não foi possível confirmar o funcionamento da loja');}
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) {
    throw new StoreStatusUnavailable('Banco da loja não configurado');
  }
  let response;
  try {
    response = await fetch(url + '/rest/v1/restaurant_operations?restaurant_id=eq.opanquecao&select=restaurant_id,time_zone,accepting_orders,enforce_opening_hours,weekly_schedule,holiday_exceptions,manual_state,manual_override_until&limit=1', {
      headers:{apikey:key,Accept:'application/json'}, cache:'no-store', signal:AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Consulta indisponível');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].restaurant_id !== 'opanquecao')
      throw new Error('Operação não cadastrada');
    return {enabled:true, ...resolveStoreStatus(rows[0],now)};
  } catch {
    throw new StoreStatusUnavailable('Não foi possível confirmar o funcionamento da loja');
  }
}
module.exports = { enforced, loadStoreStatus, StoreStatusUnavailable };
