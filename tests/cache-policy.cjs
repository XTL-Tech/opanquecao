'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const headers = config.headers || [];
const policyFor = source => {
  const rule = headers.find(item => item.source === source);
  return rule?.headers?.find(item => item.key.toLowerCase() === 'cache-control')?.value;
};

assert.equal(policyFor('/cardapio.json'), 'public, max-age=30, must-revalidate');
assert.equal(policyFor('/img/(.*)'), 'public, max-age=86400, must-revalidate');
assert.equal(policyFor('/favicons/(.*)'), 'public, max-age=86400, must-revalidate');
assert.equal(headers.some(item => item.source.startsWith('/api')), false,
  'APIs não podem herdar cache estático sem revisão explícita');

const orderSource = fs.readFileSync(path.join(root, 'api', 'order.js'), 'utf8');
assert.match(orderSource, /setHeader\('Cache-Control',\s*'no-store'\)/,
  'Pedidos não podem ser armazenados em cache');

const response = {
  headers: {},
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  json(data) { this.data = data; return this; },
  status(code) { this.code = code; return this; },
  end() { return this; }
};
require(path.join(root, 'api', 'order-config.js'))({method: 'GET'}, response);
assert.equal(response.headers['cache-control'], 'public, max-age=15, s-maxage=60');
assert.equal(response.data.testMode, process.env.VERCEL_ENV !== 'production');
assert.ok(!Object.hasOwn(response.data, 'TELEGRAM_BOT_TOKEN'),
  'A API nunca pode expor credenciais');

const photosDir = path.join(root, 'img', 'cardapio');
const photos = fs.readdirSync(photosDir).filter(file => file.endsWith('.webp'));
assert.ok(photos.length >= 80, 'Não remover fotografias comerciais');
let total = 0;
for (const file of photos) {
  const bytes = fs.statSync(path.join(photosDir, file)).size;
  total += bytes;
  assert.ok(bytes <= 400 * 1024,
    `Imagem acima de 400 KiB: ${file} (${bytes} bytes)`);
}
assert.ok(total <= 22 * 1024 * 1024, 'Catálogo de fotos acima de 22 MiB');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /loading="lazy"/, 'Preservar carregamento preguiçoso das fotos');
console.log(`Cache seguro; ${photos.length} fotos WebP; ${(total / 1048576).toFixed(2)} MiB.`);
