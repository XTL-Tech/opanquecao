'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const cart=fs.readFileSync('cart.mjs','utf8');
assert.match(html, /<form id="checkout" class="order-form" hidden>/);
assert.equal((html.match(/data-checkout-step=/g)||[]).length,0,'No mandatory checkout steps in production');
assert.equal((html.match(/data-progress-step=/g)||[]).length,0);
assert.match(html, /id="orderNote" name="orderNote" maxlength="400"/);
assert.match(html, /id="sendOrder" disabled>Enviar pedido pelo WhatsApp/);
assert.match(html, /id="whatsappOrderLink"/);
const form=html.match(/<form id="checkout"[\\s\\S]*?<\\/form>/)?.[0]||'';
assert.ok(form,'Simple order form must exist');
assert.doesNotMatch(form,/\\brequired\\b|name="name"|name="phone"|name="paymentMethod"|name="fulfillment"|id="captureLocation"/,
    'Production form must not require personal or delivery data');
assert.match(cart,/buildSimpleWhatsAppMessage/);
assert.doesNotMatch(cart,/fetch\\(['"]\\/api\\/order|ensureTurnstile|paymentMethod/);
console.log('PASS: checkout simplificado com nota opcional, link de contingência e nenhum dado pessoal obrigatório.');
