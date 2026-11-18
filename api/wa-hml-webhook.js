'use strict';
const { createHmac, createHash, timingSafeEqual } = require('node:crypto');

const LIMIT_BYTES = 262144;
const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const compare = (provided, expected) => {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const verifySignature = (rawBody, signature, appSecret) => {
  if (!Buffer.isBuffer(rawBody) || !appSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return compare(signature, expected);
};

async function readRaw(req) {
  const blocks = [];
  let size = 0;
  for await (const part of req) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buffer.length;
    if (size > LIMIT_BYTES) throw Object.assign(new Error('too_large'), {status: 413});
    blocks.push(buffer);
  }
  return Buffer.concat(blocks);
}

function summarizeEvent(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      for (const message of value.messages || []) {
        const content = typeof message.text?.body === 'string' ? message.text.body : '';
        const marker = content.match(/\bXTL-HML-[A-Z0-9-]{8,32}\b/i)?.[0] || null;
        events.push({ kind: 'received', id: hash(message.id || ''), type: message.type || 'unknown', testMarker: marker });
      }
      for (const status of value.statuses || []) {
        events.push({ kind: 'status', id: hash(status.id || ''), status: status.status || 'unknown' });
      }
    }
  }
  return events;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const verifyToken = process.env.WA_HML_VERIFY_TOKEN;
  const appSecret = process.env.WA_HML_APP_SECRET;
  if (req.method === 'GET') {
    if (!verifyToken) return res.status(503).send('Webhook de homologação não configurado');
    const url = new URL(req.url || '/', 'https://localhost');
    const mode = req.query?.['hub.mode'] || url.searchParams.get('hub.mode');
    const provided = req.query?.['hub.verify_token'] || url.searchParams.get('hub.verify_token');
    const challenge = req.query?.['hub.challenge'] || url.searchParams.get('hub.challenge');
    if (mode !== 'subscribe' || !compare(provided, verifyToken) || !/^\d{1,30}$/.test(String(challenge || ''))) {
      return res.status(403).send('Forbidden');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(String(challenge));
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method not allowed');
  }
  if (!appSecret) return res.status(503).send('Webhook de homologação não configurado');
  let raw;
  try { raw = await readRaw(req); }
  catch (error) { return res.status(error.status || 400).send('Invalid body'); }
  if (!verifySignature(raw, req.headers?.['x-hub-signature-256'], appSecret)) {
    return res.status(403).send('Invalid signature');
  }
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).send('Invalid JSON'); }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return res.status(400).send('Invalid payload');
  }
  // Nunca registrar número, nome ou conteúdo de mensagem; apenas os IDs resumidos.
  for (const event of summarizeEvent(payload)) {
    console.info(JSON.stringify({ event: 'XTL_WA_HML_WEBHOOK', ...event }));
  }
  return res.status(200).send('EVENT_RECEIVED');
}
module.exports = handler;
module.exports.verifySignature = verifySignature;
module.exports.summarizeEvent = summarizeEvent;
