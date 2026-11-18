'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const catalog = JSON.parse(fs.readFileSync('cardapio.json', 'utf8'));
    const { priceOrder, orderOptions, extraOptions } = await import(path.resolve('order-catalog.mjs'));
    const { buildWhatsAppMessage, whatsappOrderUrl, STORE_WHATSAPP } =
        await import(path.resolve('whatsapp-order.mjs'));
    assert.equal(STORE_WHATSAPP, '5551997383849');

    const panqueca = priceOrder(catalog, [{
        category: 'panquecas-2-sabores',
        product: 'Panqueca Meio a Meio (2 Sabores Salgados)',
        option: 'Único', quantity: 2, note: 'Sem cebola',
        flavors: ['Bacon', 'Calabresa']
    }])[0];
    const acaiCategory = catalog.categorias.find(c => c.id === 'acai');
    const acai = acaiCategory.itens.find(item =>
        orderOptions(item).some(opt => opt.label === '500ml'));
    assert.ok(acai);
    const addons = extraOptions(acai, '500ml');
    assert.ok(addons.free.length >= 4);
    assert.equal(addons.limit, 4);
    const acaiLine = priceOrder(catalog, [{
        category: 'acai', product: acai.nome, option: '500ml', quantity: 1, note: '',
        freeExtras: addons.free.slice(0, 4),
        paidExtras: addons.paid.slice(0, 1).map(option => option.label)
    }])[0];
    const lines = [panqueca, acaiLine];
    const subtotal = lines.reduce((sum, item) => sum + item.cents * item.quantity, 0);
    const base = {
        lines, name: 'Cliente fictício', phone: '(51) 99999-9999',
        fulfillment: {
            type: 'delivery', city: 'Nova Hartz', neighborhood: 'Centro',
            street: 'Rua das Flores', number: '123', complement: 'Casa 2',
            postalCode: '93890-000', reference: 'Portão azul',
            latitude: '-29.585', longitude: '-50.938'
        },
        payment: { method: 'cash', changeForCents: 30000 },
        deliveryFeeCents: 700
    };
    const message = buildWhatsAppMessage(base);
    assert.match(message, /PRÉ-PEDIDO \| DISK PANQUECÃO/);
    assert.match(message, /Aguardando confirmação da loja/);
    assert.match(message, /Cliente fictício/);
    assert.match(message, /51999999999/);
    assert.match(message, /Entrega em: Nova Hartz\/RS/);
    assert.match(message, /Bairro\/localidade: Centro/);
    assert.match(message, /Endereço: Rua das Flores, 123/);
    assert.match(message, /Complemento: Casa 2/);
    assert.match(message, /CEP: 93890-000/);
    assert.match(message, /Referência: Portão azul/);
    assert.match(message, /maps\?q=-29.585,-50.938/);
    assert.match(message, /2x Panqueca Meio a Meio/);
    assert.match(message, /Sabor 1: Bacon/);
    assert.match(message, /Sabor 2: Calabresa/);
    assert.match(message, /Sem cebola/);
    assert.match(message, /500ml/);
    assert.match(message, /Complementos grátis:/);
    assert.match(message, /Adicionais pagos:/);
    assert.match(message, /Taxa de entrega: R\$ 7,00/);
    assert.ok(message.includes('Subtotal dos itens: '));
    const { money } = await import(path.resolve('order-catalog.mjs'));
    assert.ok(message.includes('Total estimado: ' + money(subtotal + 700)));
    assert.match(message, /Forma: Dinheiro/);
    assert.match(message, /Troco para: R\$ 300,00/);
    assert.ok(message.includes('Troco estimado: ' + money(30000 - subtotal - 700)));
    assert.match(message, /antes do preparo/);
    const parsed = new URL(whatsappOrderUrl(message));
    assert.equal(parsed.origin, 'https://wa.me');
    assert.equal(parsed.pathname, '/' + STORE_WHATSAPP);
    assert.equal(parsed.searchParams.get('text'), message, 'Acentos e quebras preservados na URL');

    const unknownArea = buildWhatsAppMessage({
        ...base, deliveryFeeCents: null,
        fulfillment: {...base.fulfillment, neighborhood: '__other__', otherNeighborhood: 'Linha Nova'}
    });
    assert.match(unknownArea, /Bairro\/localidade: Linha Nova/);
    assert.match(unknownArea, /Taxa de entrega: A CONFIRMAR/);
    assert.match(unknownArea, /Total: a confirmar/);
    assert.match(unknownArea, /Troco: a confirmar/);

    const pickup = buildWhatsAppMessage({...base,
        fulfillment: {type: 'pickup'}, deliveryFeeCents: null,
        payment: {method: 'pix', changeForCents: null}
    });
    assert.match(pickup, /Retirada no estabelecimento/);
    assert.match(pickup, /Taxa de entrega: não se aplica/);
    assert.match(pickup, /Forma: Pix/);
    assert.doesNotMatch(pickup, /Rua das Flores/);

    const table = buildWhatsAppMessage({...base,
        fulfillment: {type: 'table', table: 'Mesa 05'},
        payment: {method: 'debit', changeForCents: null}
    });
    assert.match(table, /Mesa: Mesa 05/);
    assert.match(table, /Forma: Cartão de débito/);
    assert.throws(() => buildWhatsAppMessage({...base,
        fulfillment: {type:'table', table:''}}), /mesa/);
    assert.throws(() => buildWhatsAppMessage({...base,phone:'123'}), /WhatsApp válido/);
    assert.throws(() => buildWhatsAppMessage({...base,
        payment:{method:'cash',changeForCents:100}}), /troco/);
    assert.throws(() => buildWhatsAppMessage({...base,
        fulfillment:{...base.fulfillment,city:'Cidade inventada'}}), /cidade/);

    console.log('PASS: WhatsApp direto contém itens, sabores, complementos, taxas, total, endereço, GPS, pagamento e troco.');
})().catch(err => { console.error(err); process.exitCode = 1; });
