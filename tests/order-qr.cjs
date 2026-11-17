'use strict';
const assert = require('node:assert/strict');
const { PDFPage, PDFDocument } = require('pdf-lib');
const { orderPdf } = require('../lib/order-pdf');
const { directionsUrl, createDirectionsQr } = require('../lib/location-qr');

const fix = {
    id: 'TEST1234', name: 'CLIENTE FICTICIO', phone: '51999999999',
    items: [{ quantity: 1, product: 'Panqueca teste', option: 'Único', cents: 4200 }],
    subtotal: 4200,
    money: cents => 'R$ ' + (cents / 100).toFixed(2),
    payment: { method: 'pix', label: 'Pix', changeForCents: null },
    testMode: true
};
const loc = { latitude: -29.585, longitude: -50.938 };
const delivery = location => ({
    type: 'delivery', city: 'Nova Hartz', neighborhood: 'Centro',
    street: 'Rua de Teste', number: '123', complement: '',
    postalCode: '', reference: '', feeCents: 700, location
});

async function renderWithRectangles(fulfillment, printWidth) {
    const original = PDFPage.prototype.drawRectangle;
    const rects = [];
    PDFPage.prototype.drawRectangle = function (params) {
        rects.push({ ...params, pageWidth: this.getWidth(), pageHeight: this.getHeight() });
        return original.call(this, params);
    };
    const old = process.env.ORDER_PRINT_WIDTH_MM;
    if (printWidth) process.env.ORDER_PRINT_WIDTH_MM = String(printWidth);
    else delete process.env.ORDER_PRINT_WIDTH_MM;
    try {
        const bytes = await orderPdf({ ...fix, fulfillment });
        return { pdf: await PDFDocument.load(bytes), rects };
    } finally {
        PDFPage.prototype.drawRectangle = original;
        if (old === undefined) delete process.env.ORDER_PRINT_WIDTH_MM;
        else process.env.ORDER_PRINT_WIDTH_MM = old;
    }
}

(async () => {
    const url = directionsUrl(loc);
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'www.google.com');
    assert.equal(parsed.pathname, '/maps/dir/');
    assert.equal(parsed.searchParams.get('api'), '1');
    assert.equal(parsed.searchParams.get('destination'), '-29.585000,-50.938000');
    assert.equal(parsed.searchParams.get('travelmode'), 'driving');

    for (const invalid of [null, {}, { latitude: '1', longitude: 1 },
        { latitude: 91, longitude: 0 }, { latitude: -29, longitude: Infinity },
        { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: -181 }]) {
        assert.equal(directionsUrl(invalid), null, 'coordenada inválida não deve gerar rota');
        assert.equal(createDirectionsQr(invalid), null);
    }
    const matrix = createDirectionsQr(loc);
    assert.ok(matrix.size >= 21 && matrix.size <= 57, 'tamanho QR para URL curta');
    assert.equal(matrix.isDark(0, 0), true, 'finder pattern QR');
    assert.equal(matrix.isDark(1, 1), false, 'finder pattern QR');
    assert.equal(matrix.isDark(3, 3), true, 'finder pattern QR');

    for (const printWidth of [40, 58, 'a4']) {
        const { pdf, rects } = await renderWithRectangles(delivery(loc), printWidth);
        const locationModules = rects.filter(r => r.height < 15);
        assert.ok(locationModules.length > 80, 'QR vetorial deve ser desenhado no cupom');
        const expected = printWidth === 'a4' ? 210 : printWidth;
        assert.ok(Math.abs(pdf.getPages()[0].getWidth() - expected * 72 / 25.4) < 0.15);
        assert.ok(pdf.getPageCount() >= 1);
        for (const r of rects) {
            assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0, 'QR dentro da página');
            assert.ok(r.x + r.width <= r.pageWidth + 0.1);
            assert.ok(r.y + r.height <= r.pageHeight + 0.1);
        }
    }

    const normal = await renderWithRectangles(delivery(null), 58);
    assert.equal(normal.rects.filter(r => r.height < 15).length, 0, 'Sem GPS, sem QR');
    const pickup = await renderWithRectangles({ type: 'pickup', location: loc }, 58);
    assert.equal(pickup.rects.filter(r => r.height < 15).length, 0, 'Sem entrega, sem QR');
    const table = await renderWithRectangles({ type: 'table', table: '2', location: loc }, 58);
    assert.equal(table.rects.filter(r => r.height < 15).length, 0, 'Comer no local não gera QR');
    const invalid = await renderWithRectangles(delivery({ latitude: 200, longitude: 1 }), 58);
    assert.equal(invalid.rects.filter(r => r.height < 15).length, 0, 'GPS inválido não gera QR');

    console.log('PASS QR motoboy: rota Google Maps, 58mm/40mm/A4, sem GPS e privacidade');
})().catch(e => { console.error(e); process.exitCode = 1; });
