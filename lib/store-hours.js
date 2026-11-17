'use strict';

// Regra pura: horário oficial America/Sao_Paulo, sem depender do relógio do cliente.
const TZ = 'America/Sao_Paulo';
const WEEK = { Sun: '0', Mon: '1', Tue: '2', Wed: '3', Thu: '4', Fri: '5', Sat: '6' };
function localTime(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Data inválida');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(({type,value}) => [type,value]));
  return { date: p.year + '-' + p.month + '-' + p.day,
    weekday: WEEK[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function parseMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h,m] = value.split(':').map(Number);
  return h * 60 + m;
}
function inWindows(windows, minute) {
  if (!Array.isArray(windows) || windows.length > 16) throw new Error('Horários inválidos');
  return windows.some(window => {
    if (!window || typeof window !== 'object') throw new Error('Faixa inválida');
    const start = parseMinutes(window.start);
    const end = parseMinutes(window.end);
    if (start === null || end === null || start >= end) throw new Error('Faixa inválida; se atravessa meia-noite, divida em dois dias');
    return minute >= start && minute < end;
  });
}
function resolveStoreStatus(operations, now = new Date()) {
  if (!operations || operations.time_zone !== TZ) throw new Error('Fuso horário não configurado');
  const { date, weekday, minutes } = localTime(now);
  const manual = operations.manual_state || 'auto';
  const until = operations.manual_override_until;
  if (!['auto','open','closed'].includes(manual)) throw new Error('Estado manual inválido');
  if (typeof operations.accepting_orders !== 'boolean') throw new Error('Configuração de atendimento inválida');
  if (!operations.accepting_orders) return {open:false, reason:'emergency_closed', date};
  if (manual !== 'auto' && until && Number.isFinite(Date.parse(until)) && Date.parse(until) > now.getTime()) {
    return {open: manual === 'open', reason: manual === 'open' ? 'manual_open' : 'manual_closed', date};
  }
  if (!operations.enforce_opening_hours) return {open:true, reason:'hours_not_enforced', date};
  const weekly = operations.weekly_schedule;
  const exceptions = operations.holiday_exceptions;
  if (!weekly || Array.isArray(weekly) || typeof weekly !== 'object' ||
      !exceptions || Array.isArray(exceptions) || typeof exceptions !== 'object') {
    throw new Error('Agenda inválida');
  }
  const exception = Object.prototype.hasOwnProperty.call(exceptions,date);
  const windows = exception ? exceptions[date] : (weekly[weekday] || []);
  const open = inWindows(windows, minutes);
  return {open, reason: exception ? (open ? 'exception_open' : 'exception_closed') :
    (open ? 'scheduled_open' : 'scheduled_closed'), date};
}
module.exports = { TZ, localTime, parseMinutes, resolveStoreStatus };
