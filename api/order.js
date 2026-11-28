const { orderPdf } = require('../lib/order-pdf');
const deliveryAreas = require('../delivery-areas.json');
const { loadCatalog, CatalogUnavailableError } = require('../lib/catalog-source');
const { UUID_V4, isEnabled, initLedger, OrderLedgerUnavailable, payloadDigest, replayResponse } = require('../lib/order-idempotency');
const { randomUUID } = require('node:crypto');
const { loadStoreStatus } = require('../lib/store-hours-source');

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if(require('../lib/digital-orders').enabled())return res.status(410).json({error:'Utilize o checkout digital atualizado.'});
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido.' });
    // Diagnóstico sem dados pessoais, sem token Turnstile e sem credenciais.
    const receivedTrace = req.headers?.['x-checkout-trace'];
    const trace = typeof receivedTrace === 'string' && /^[a-z0-9]{8}$/.test(receivedTrace)
        ? receivedTrace : randomUUID().slice(0, 8);
    const log = (step, extra = {}) => console.info(JSON.stringify({
        event: 'checkout', trace, step,
        environment: process.env.VERCEL_ENV === 'production' ? 'production' : 'preview',
        ...extra
    }));
    const reject = (code, error, step) => {
        log(step, { httpStatus: code });
        return res.status(code).json({ error, trace });
    };
    log('received');
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY } = process.env;
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TURNSTILE_SECRET_KEY) {
        return reject(503, 'Pedido digital indisponível no momento. Entre em contato com a loja.', 'configuration_missing');
    }
    // Não confiar somente no popup: o bloqueio real acontece antes do Telegram.
    try {
        const store = await loadStoreStatus();
        if (store.enabled && !store.open) {
            return reject(423, 'Loja fechada no momento. Consulte o cardápio e tente novamente quando abrirmos.', 'store_closed');
        }
    } catch {
        return reject(503, 'Não foi possível confirmar a abertura da loja. Tente novamente mais tarde.', 'store_status_unavailable');
    }
    const { lines, name, phone, challenge, fulfillment, payment, requestId } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80 ||
        typeof phone !== 'string' || !/^\d{10,11}$/.test(phone) ||
        typeof challenge !== 'string' || !challenge || challenge.length > 2048) {
        return reject(400, 'Confira seu nome, telefone e a verificação.', 'identity_fields');
    }
    const method = fulfillment?.type;
    if (!['delivery', 'pickup', 'table'].includes(method)) {
        return reject(400, 'Selecione entrega, retirada ou mesa.', 'fulfillment_type');
    }
    if(method==='delivery'&&require('../lib/customer-cpf').enabled())return reject(409,'Use o checkout atualizado para delivery.','legacy_delivery_disabled');
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
            return reject(400, 'Confira cidade, bairro, rua, número e demais dados de entrega.', 'delivery_fields');
        }
        // Taxa definida pelo servidor. Área cadastrada herda o padrão da cidade.
        // Localidade informada manualmente necessita confirmação comercial.
        const feeCents = selectedArea
            ? (selectedArea.feeCents ?? deliveryAreas.defaultFeeCents?.[city]) : null;
        deliveryDetails = { ...deliveryDetails, city, neighborhood: neighborhoodName, street, number,
            postalCode, complement, reference,
            feeCents: Number.isSafeInteger(feeCents) && feeCents >= 0 && feeCents <= 10000 ? feeCents : null,
            address: [street + ', ' + number, complement, neighborhoodName + ', ' + city + '/RS', postalCode].filter(Boolean).join(' - ') };
    }
    if (method === 'table' && (!table || table.length > 12 || !/^[\p{L}\p{N} -]+$/u.test(table))) {
        return reject(400, 'Informe a identificação da mesa.', 'table_fields');
    }
    const hasLatitude = fulfillment.latitude !== null && fulfillment.latitude !== undefined && fulfillment.latitude !== '';
    const hasLongitude = fulfillment.longitude !== null && fulfillment.longitude !== undefined && fulfillment.longitude !== '';
    if (hasLatitude !== hasLongitude || (method !== 'delivery' && (hasLatitude || hasLongitude))) {
        return reject(400, 'Localização inválida para este tipo de pedido.', 'geolocation_mode');
    }
    let location = null;
    if (hasLatitude) {
        const latitude = Number(fulfillment.latitude);
        const longitude = Number(fulfillment.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return reject(400, 'Coordenadas de localização inválidas.', 'geolocation_values');
        }
        location = { latitude, longitude };
    }
    const delivery = { ...deliveryDetails, table: method === 'table' ? table : '', location };
    const { priceOrder, money } = await import('../order-catalog.mjs');
    let items;
    try {
        const catalog = await loadCatalog();
        items = priceOrder(catalog, lines);
    } catch (error) {
        if (error instanceof CatalogUnavailableError) return reject(503, 'Cardápio indisponível para confirmação. Tente novamente mais tarde.', 'catalog_unavailable');
        return reject(400, 'Confira os itens e as opções do carrinho.', 'cart_validation');
    }
    const testMode = process.env.VERCEL_ENV !== 'production';
    const subtotal = items.reduce((total, item) => total + item.cents * item.quantity, 0);
    const { validatePayment } = await import('../payment.mjs');
    let validatedPayment;
    try {
        const totalKnown = method !== 'delivery' || delivery.feeCents !== null;
        const amountDue = subtotal + (delivery.feeCents ?? 0);
        validatedPayment = validatePayment(payment, amountDue, totalKnown);
    } catch (e) {
        return reject(400, e.message, 'payment_fields');
    }
    // Registrar idempotência APÓS todas as validações comerciais. Não gerar
    // efeito externo se o ledger obrigatório estiver indisponível.
    let ledger = null;
    let digest = null;
    if (isEnabled()) {
        if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) {
            return reject(400, 'Atualize o cardápio para enviar um pedido seguro.', 'request_id');
        }
        try {
            ledger = initLedger();
            digest = payloadDigest({ name: name.trim(), phone, items, delivery, payment: validatedPayment });
            const known = replayResponse(await ledger.lookup(requestId), digest);
            if (known) {
                log('ledger_replay', { httpStatus: known.httpStatus });
                return res.status(known.httpStatus).json({ ...known.body, trace });
            }
        } catch (error) {
            if (error instanceof OrderLedgerUnavailable) {
                return reject(503, 'Pedidos temporariamente indisponíveis. Entre em contato com a loja.', 'ledger_unavailable');
            }
            throw error;
        }
    }
    const id = ledger ? requestId.replace(/-/g, '').slice(0, 8) : randomUUID().slice(0, 8);
    let claimed = false;
    let stage = 'turnstile';
    let telegramStatus = null;
    try {
        const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: challenge }),
            signal: AbortSignal.timeout(6000)
        });
        const verified = await check.json();
        if (!verified.success) return reject(400, 'Refaça a verificação de segurança.', 'turnstile_rejected');
        if (ledger) {
            stage = 'ledger';
            try {
                claimed = await ledger.claim({ requestId, digest, orderRef: id });
                if (!claimed) {
                    const known = replayResponse(await ledger.lookup(requestId), digest);
                    if (!known) throw new OrderLedgerUnavailable('Registro concorrente não encontrado');
                    log('ledger_replay', { httpStatus: known.httpStatus });
                    return res.status(known.httpStatus).json({ ...known.body, trace });
                }
            } catch {
                return reject(503, 'Não foi possível registrar o pedido com segurança. Contate a loja.', 'ledger_claim_failed');
            }
        }
        stage = 'pdf';
        const pdf = await orderPdf({ id, name: name.trim(), phone, items, subtotal, money, fulfillment: delivery, payment: validatedPayment, testMode });
        const form = new FormData();
        form.set('chat_id', TELEGRAM_CHAT_ID);
        form.set('caption', (testMode ? 'TESTE - NAO PREPARAR!\n' : '') +
            '🔔 NOVO PEDIDO\nAguardando confirmação pelo WhatsApp.');
        const whatsAppLink = 'https://wa.me/55' + phone + '?text=' +
            encodeURIComponent('Olá! Aqui é o Disk Panquecão. Podemos confirmar os detalhes do seu pedido #' + id + '?');
        form.set('reply_markup', JSON.stringify({
            inline_keyboard: [[{ text: '💬 Confirmar pedido com cliente', url: whatsAppLink }]]
        }));
        form.set('document', new Blob([pdf], { type: 'application/pdf' }), `${testMode ? 'TESTE-nao-preparar-' : 'pre-pedido-'}${id}.pdf`);
        stage = 'telegram';
        const sent = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(8000)
        });
        telegramStatus = Number.isInteger(sent.status) ? sent.status : null;
        const telegram = await sent.json();
        if (!sent.ok || !telegram.ok) throw new Error('Telegram indisponível');
        if (ledger) {
            stage = 'ledger_finish';
            try {
                await ledger.finish(requestId, 'delivered', telegram.result?.message_id);
            } catch {
                log('ledger_confirmation_pending', { httpStatus: 202 });
                return res.status(202).json({ id, pending: true, trace,
                    error: 'A loja pode ter recebido o pedido, mas não foi possível confirmar o registro. Não reenvie.' });
            }
        }
        log('sent', { httpStatus: 200 });
        return res.status(200).json({ id, test: testMode, trace });
    } catch (error) {
        if (claimed) {
            try { await ledger.finish(requestId, 'needs_review'); } catch { /* Reconciliar manualmente. */ }
            log('delivery_uncertain', { httpStatus: 202, stage, telegramStatus });
            return res.status(202).json({ id, pending: true, trace,
                error: 'Não foi possível confirmar o envio. Consulte a loja e não envie novamente.' });
        }
        log('failed', { httpStatus: 502, stage, telegramStatus,
            reason: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'other' });
        return res.status(502).json({
            error: 'Não foi possível confirmar o envio. Fale com a loja antes de reenviar.', trace
        });
    }
};
