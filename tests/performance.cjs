'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync('index.html','utf8');
const cart=fs.readFileSync('cart.mjs','utf8');
const reportPath=path.join('img','cardapio-lite','optimization-report.json');
assert.ok(fs.existsSync(reportPath),'Thumbnails não gerados. Execute scripts/generate-cardapio-lite.py');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
assert.equal(report.source_count,82);
assert.equal(report.images.length,82);
assert.ok(report.optimized_total_bytes<report.original_total_bytes*0.65,
    'Thumbnails devem economizar pelo menos 35% do tráfego em fotos');
for(const item of report.images){
    const f=path.join('img','cardapio-lite',item.file);
    assert.ok(fs.existsSync(f),'Thumb ausente: '+item.file);
    assert.equal(fs.statSync(f).size,item.bytes);
    assert.ok(item.width<=560 && item.height<=560);
}
assert.match(html,/src="img\/cardapio-lite\/\$\{photo\.split\('\/'\)\.pop\(\)\}"/);
assert.match(html,/data-full-src="img\/\$\{photo\}"/);
assert.match(html,/image\.src = image\.dataset\.fullSrc/);
assert.match(html,/cover\.loading = index < 2/);
assert.doesNotMatch(html,/fetch\('\/api\/catalog',\s*\{\s*cache:\s*'no-store'/);
assert.doesNotMatch(html,/<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
assert.match(cart,/whatsappOrderUrl\(message\)/);
assert.doesNotMatch(cart,/fetch\('\/api\/order'/);
assert.doesNotMatch(cart,/ensureTurnstile/);
console.log('PASS otimização: '+report.source_count+' thumbnails, economia '+report.saved_percent+'%, cache e WhatsApp direto');
