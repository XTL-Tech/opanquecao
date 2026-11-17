const { orderPdf } = require('../lib/order-pdf');
const deliveryAreas = require('../delivery-areas.json');
const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido.' });
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY } = process.env;
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TURNSTILE_SECRET_KEY) {
        return res.status(503).json({ error: 'Pedido digital indisponível no momento. Entre em contato com a loja.' });
    }
    const { lines, name, phone, challenge, fulfillment } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80 ||
        typeof phone !== 'string' || !/^\d{10,11}$/.test(phone) ||
        typeof challenge !== 'string' || !challenge || challenge.length > 2048) {
        return res.status(400).json({ error: 'Confira seu nome, telefone e a verificação.' });
    }
    const method = fulfillment?.type;
    if (!['delivery', 'pickup', 'table'].includes(method)) {
        return res.status(400).json({ error: 'Selecione entrega, retirada ou mesa.' });
    }
    const table = typeof fulfillment.table === 'string' ? fulfillment.table.trim() : '';
    const clean = (value, maxLength) => typeof value === 'string' &&
        value.trim().length <= maxLength && !/[\x00-\x1f\x7f]/u.test(value) ? value.trim() : null;
    let deliveryDetails = { type: method, address: '', city: '', neighborhood: '', street: '',
        number: '', postalCode: '', complement: '', reference: '', feeCents: null };
    if (method === 'delivery') {
        const city = clean(fulfillment.city, 40);
        const neighborhood = clean(fulfillment.neighborhood, 100);
        const otherNeighborhood = clean(fulfillment.otherNeighborhood ?? '', 80);
        const street = clean(fulfillment.street, 120);
        const number = clean(fulfillment.number, 20);
        const postalCode = clean(fulfillment.postalCode ?? '', 9);
        const complement = clean(fulfillment.complement ?? '', 100);
        const reference = clean(fulfillment.reference ?? '', 140);
        const areas = Object.hasOwn(deliveryAreas.cities, city) ? deliveryAreas.cities[city] : null;
        const selectedArea = areas?.find(area => area.name === neighborhood);
        const neighborhoodName = neighborhood === '__other__' ? otherNeighborhood : selectedArea?.name;
        if (!areas || !neighborhoodName || neighborhoodName.length < 2 ||
            (neighborhood === '__other__' && neighborhoodName.length < 3) ||
            !street || street.length < 3 || !number || !postalCode?.match(/^(?:\d{5}-?\d{3})?$/) ||
            complement === null || reference === null) {
            return res.status(400).json({ error: 'Confira cidade, bairro, rua, número e demais dados de entrega.' });
        }
        const feeCents = selectedArea?.feeCents;
        deliveryDetails = { ...deliveryDetails, city, neighborhood: neighborhoodName, street, number,
            postalCode, complement, reference,
            feeCents: Number.isSafeInteger(feeCents) && feeCents >= 0 && feeCents <= 10000 ? feeCents : null,
            address: [street + ', ' + number, complement, neighborhoodName + ', ' + city + '/RS', postalCode].filter(Boolean).join(' - ') };
    }
    if (method === 'table' && (!table || table.length > 12 || !/^[\p{L}\p{N} -]+$/u.test(table))) {
        return res.status(400).json({ error: 'Informe a identificação da mesa.' });
    }
    const hasLatitude = fulfillment.latitude !== null && fulfillment.latitude !== undefined && fulfillment.latitude !== '';
    const hasLongitude = fulfillment.longitude !== null && fulfillment.longitude !== undefined && fulfillment.longitude !== '';
    if (hasLatitude !== hasLongitude || (method !== 'delivery' && (hasLatitude || hasLongitude))) {
        return res.status(400).json({ error: 'Localização inválida para este tipo de pedido.' });
    }
    let location = null;
    if (hasLatitude) {
        const latitude = Number(fulfillment.latitude);
        const longitude = Number(fulfillment.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ error: 'Coordenadas de localização inválidas.' });
        }
        location = { latitude, longitude };
    }
    const delivery = { ...deliveryDetails, table: method === 'table' ? table : '', location };
    const { priceOrder, money } = await import('../order-catalog.mjs');
    let items;
    try {
        const catalog = JSON.parse(await readFile(require('node:path').join(process.cwd(), 'cardapio.json'), 'utf8'));
        items = priceOrder(catalog, lines);
    } catch {
        return res.status(400).json({ error: 'Confira os itens e as opções do carrinho.' });
    }
    const id = randomUUID().slice(0, 8);
    const testMode = process.env.VERCEL_ENV !== 'production';
    const subtotal = items.reduce((total, item) => total + item.cents * item.quantity, 0);
    try {
        const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: challenge }),
            signal: AbortSignal.timeout(6000)
        });
        const verified = await check.json();
        if (!verified.success) return res.status(400).json({ error: 'Refaça a verificação de segurança.' });
        const pdf = await orderPdf({ id, name: name.trim(), phone, items, subtotal, money, fulfillment: delivery, testMode });
        const form = new FormData();
        form.set('chat_id', TELEGRAM_CHAT_ID);
        const feeDescription = method === 'delivery'
            ? (delivery.feeCents === null ? 'Taxa: a confirmar' :
                'Taxa: ' + money(delivery.feeCents) + ' · Total: ' + money(subtotal + delivery.feeCents))
            : '';
        form.set('caption', `${testMode ? 'TESTE - NAO PREPARAR!\n' : ''}Pré-pedido #${id} · ${name.trim()} · ${{delivery:'Entrega',pickup:'Retirada',table:'Mesa'}[method]}
Produtos: ${money(subtotal)}${feeDescription ? ' · ' + feeDescription : ''}
Aguardando confirmação da loja.`);
        form.set('document', new Blob([pdf], { type: 'application/pdf' }), `${testMode ? 'TESTE-nao-preparar-' : 'pre-pedido-'}${id}.pdf`);
        const sent = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(8000)
        });
        if (!sent.ok || !(await sent.json()).ok) throw new Error('Telegram indisponível');
        return res.status(200).json({ id, test: testMode });
    } catch {
        return res.status(502).json({ error: 'Não foi possível confirmar o envio. Fale com a loja antes de reenviar.' });
    }
};
