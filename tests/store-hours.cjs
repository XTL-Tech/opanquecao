'use strict';
const assert = require('node:assert/strict');
const { resolveStoreStatus, localTime, parseMinutes } = require('../lib/store-hours');
const base = {time_zone:'America/Sao_Paulo',accepting_orders:true,enforce_opening_hours:true,
  weekly_schedule:{'2':[{start:'19:00',end:'23:00'}]},holiday_exceptions:{},manual_state:'auto'};
const at = iso => new Date(iso);
assert.deepEqual(localTime(at('2026-11-17T22:30:00Z')),{date:'2026-11-17',weekday:'2',minutes:1170});
assert.equal(parseMinutes('23:30'),1410);
assert.equal(parseMinutes('24:00'),null);
assert.equal(resolveStoreStatus(base,at('2026-11-17T22:30:00Z')).open,true);
assert.equal(resolveStoreStatus(base,at('2026-11-18T02:00:00Z')).open,false);
assert.equal(resolveStoreStatus({...base,manual_state:'open',manual_override_until:'2026-11-18T08:00:00Z'},at('2026-11-18T03:00:00Z')).open,true);
assert.equal(resolveStoreStatus({...base,manual_state:'closed',manual_override_until:'2026-11-18T08:00:00Z'},at('2026-11-17T22:30:00Z')).open,false);
assert.equal(resolveStoreStatus({...base,manual_state:'open',manual_override_until:'2026-11-17T18:00:00Z'},at('2026-11-18T03:00:00Z')).open,false);
assert.equal(resolveStoreStatus({...base,accepting_orders:false,manual_state:'open',manual_override_until:'2026-11-18T08:00:00Z'},at('2026-11-18T03:00:00Z')).open,false);
assert.equal(resolveStoreStatus({...base,holiday_exceptions:{'2026-11-17':[]}},at('2026-11-17T22:30:00Z')).open,false);
assert.equal(resolveStoreStatus({...base,weekly_schedule:{},holiday_exceptions:{'2026-11-17':[{start:'19:00',end:'23:00'}]}},at('2026-11-17T22:30:00Z')).open,true);
assert.throws(()=>resolveStoreStatus({...base,weekly_schedule:{'2':[{start:'23:00',end:'01:00'}]}},at('2026-11-17T22:30:00Z')));
console.log('PASS: timezone, boundaries, automatic hours, holidays, override expiry and emergency close');
