'use strict';
const db=require('./backoffice-neon'),c=require('./backoffice-core'),{AuthError}=require('./backoffice-neon-auth');
const {parseMinutes,resolveStoreStatus}=require('./store-hours');
function guard(actor){if(!['admin','manager'].includes(actor.role))throw new AuthError('Horários restritos à administração.',403);}
function agenda(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==7)c.fail('Configure os sete dias da semana.');
 const out={};
 for(let d=0;d<7;d++){
  const w=v[d];if(!Array.isArray(w)||w.length>4)c.fail('Até quatro períodos por dia.');
  const arr=w.map(x=>{const start=x?.start,end=x?.end,a=parseMinutes(start),b=parseMinutes(end);if(a===null||b===null||a>=b)c.fail('Confira abertura e fechamento.');return {start,end};}).sort((a,b)=>a.start.localeCompare(b.start));
  if(arr.some((x,i)=>i&&x.start<arr[i-1].end))c.fail('Períodos de atendimento não podem se sobrepor.');
  out[d]=arr;
 }return out;
}
async function get(actor){
 guard(actor);const rows=await db.run("SELECT accepting_orders,weekly_schedule,holiday_exceptions,manual_state,manual_override_until,revision,time_zone,enforce_opening_hours FROM dp.store_operations WHERE restaurant_id='opanquecao'");
 const config=rows[0]||null;return {config,status:config?resolveStoreStatus(config):null,integrated:process.env.STORE_HOURS_MODE==='required'&&process.env.STORE_HOURS_SOURCE==='neon'};
}
async function save(actor,b){
 guard(actor);const weekly=agenda(b.weeklySchedule);
 if(typeof b.acceptingOrders!=='boolean')c.fail('Selecione o modo de atendimento.');
 const mode=b.manualState||'auto';if(!['auto','open','closed'].includes(mode))c.fail('Modo inválido.');
 let until=null;if(mode!=='auto'){
  const minutes=Number(b.overrideMinutes);if(!Number.isInteger(minutes)||minutes<5||minutes>1440)c.fail('Exceção de 5 minutos a 24 horas.');
  until=new Date(Date.now()+minutes*60000).toISOString();
 }
 const revision=Number(b.revision);if(!Number.isInteger(revision)||revision<0)c.fail('Revisão inválida.');
 const p=[JSON.stringify(weekly),b.acceptingOrders,mode,until,actor.id];
 const rows=revision===0?await db.run("INSERT INTO dp.store_operations(restaurant_id,weekly_schedule,accepting_orders,manual_state,manual_override_until,updated_by) VALUES('opanquecao',$1::jsonb,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING revision",p):await db.run("UPDATE dp.store_operations SET weekly_schedule=$1::jsonb,accepting_orders=$2,manual_state=$3,manual_override_until=$4,updated_by=$5,revision=revision+1,updated_at=now() WHERE restaurant_id='opanquecao' AND revision=$6 RETURNING revision",[...p,revision]);
 if(rows.length!==1)throw new db.StoreError('Horários alterados por outro operador. Recarregue.',409);return {revision:rows[0].revision};
}
module.exports={get,save,agenda};
