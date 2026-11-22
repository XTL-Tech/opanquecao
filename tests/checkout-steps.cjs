'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const cart = fs.readFileSync('cart.mjs', 'utf8');
assert.match(html, /id="startCheckout"/);
assert.match(html, /<form id="checkout" class="order-form" hidden>/);
assert.match(html, /id="customerName" name="customerName"[^>]+required/);
assert.match(html, /id="customerPhone" name="customerPhone"[^>]+required/);
assert.match(html, /id="orderNote" name="orderNote" maxlength="400"/);
assert.match(html, /id="orderTurnstile"/);
assert.match(html, /name="fulfillmentType" value="delivery" checked/);
assert.match(html, /name="fulfillmentType" value="pickup"/);
assert.match(html, /name="fulfillmentType" value="table"/);
for(const name of ['deliveryCity','deliveryNeighborhood','deliveryStreet','deliveryNumber',
  'deliveryComplement','deliveryReference','captureDeliveryLocation','removeDeliveryLocation',
  'deliveryLocationPreview','tableIdentifier']){
  assert.ok(html.includes('id="'+name+'"'),'Campo ausente: '+name);
}
assert.match(html, /Taxa de entrega a confirmar/);
assert.match(html, /não pedimos CPF/);
assert.match(html, /id="sendOrder" disabled>Registrar e abrir WhatsApp/);
assert.match(html, /id="whatsappOrderLink"/);
assert.match(html, /id="cartFeedbackCart"/);
assert.match(html, /class="quick-add card-primary-action"/);
assert.match(html, /class="product-details details-link">Ver detalhes/);
assert.match(html, /class="product-details card-primary-action"/);
assert.match(html, /mustConsult \? 'Consultar preço' : 'Escolher opções'/);
assert.doesNotMatch(html, /class="menu-actions"/, 'Não exibir dois botões grandes lado a lado');
const form = html.match(/<form id="checkout"[\s\S]*?<\/form>/)?.[0] || '';
assert.ok(form);
assert.doesNotMatch(form, /name="paymentMethod"|name="fulfillment"|id="captureLocation"/);
assert.match(cart, /async function getChallenge/);
assert.match(cart, /fetch\('\/api\/whatsapp-intent'/);
assert.match(cart, /window\.turnstile\.execute/);
assert.match(cart, /response\.ok/);
assert.match(cart, /buildSimpleWhatsAppMessage/);
assert.match(cart, /function announceAdded/);
assert.match(cart, /function openWhatsApp/);
assert.match(cart, /normalizeFulfillment/);
assert.match(cart, /navigator\.geolocation\.getCurrentPosition/);
assert.match(cart, /delivery-areas\.json/);
assert.doesNotMatch(cart, /localStorage\.setItem\([^\n]*(?:address|latitude|longitude)/i);
assert.doesNotMatch(cart, /fetch\('\/api\/order'/);
console.log('PASS: compra rápida, carrinho em duas etapas, contato e registro protegido no bot.');
