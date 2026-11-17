const { orderPdf } = require('../lib/order-pdf');
const { loadCatalog, CatalogUnavailableError } = require('../lib/catalog-source');
const { randomUUID } = require('node:crypto');
const { UUID_V4, isEnabled, initLedger, OrderLedgerUnavailable, payloadDigest, replayResponse } = require('../lib/order-idempotency');

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido.' });
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY } = process.env;
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TURNSTILE_SECRET_KEY) {
        return res.status(503).json({ error: 'Pedido digital indisponível no momento. Entre em contato com a loja.' });
    }
    const { lines, name, phone, challenge, fulfillment, requestId } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80 ||
        typeof phone !== 'string' || !/^\d{10,11}$/.test(phone) ||
        typeof challenge !== 'string' || !challenge || challenge.length > 2048) {
        return res.status(400).json({ error: 'Confira seu nome, telefone e a verificação.' });
    }
    const method = fulfillment?.type;
    if (!['delivery', 'pickup', 'table'].includes(method)) {
        return res.status(400).json({ error: 'Selecione entrega, retirada ou mesa.' });
    }
    const address = typeof fulfillment.address === 'string' ? fulfillment.address.trim() : '';
    const table = typeof fulfillment.table === 'string' ? fulfillment.table.trim() : '';
    if (method === 'delivery' && (address.length < 8 || address.length > 220 || /[\x00-\x1f\x7f]/u.test(address))) {
        return res.status(400).json({ error: 'Informe rua, número, bairro e cidade para entrega.' });
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
    const delivery = { type: method, address: method === 'delivery' ? address : '',
        table: method === 'table' ? table : '', location };
    const { priceOrder, money } = await import('../order-catalog.mjs');
    let items;
    try {
        const catalog = await loadCatalog();
        items = priceOrder(catalog, lines);
    } catch (error) {
        if (error instanceof CatalogUnavailableError) {
            return res.status(503).json({ error: 'Cardápio indisponível para confirmação. Tente novamente mais tarde.' });
        }
        return res.status(400).json({ error: 'Confira os itens e as opções do carrinho.' });
    }
    let ledger = null;
    let digest = null;
    if (isEnabled()) {
        if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) {
            return res.status(400).json({ error: 'Atualize o cardápio para enviar um pedido seguro.' });
        }
        try {
            ledger = initLedger(); // Falha fechada se credenciais privadas ou banco estiverem indisponíveis.
            digest = payloadDigest({ name: name.trim(), phone, items, delivery });
            const known = replayResponse(await ledger.lookup(requestId), digest);
            if (known) return res.status(known.httpStatus).json(known.body);
        } catch (error) {
            if (error instanceof OrderLedgerUnavailable) {
                return res.status(503).json({ error: 'Pedidos temporariamente indisponíveis. Entre em contato com a loja.' });
            }
            throw error;
        }
    }
    const id = ledger ? requestId.replace(/-/g, '').slice(0, 8) : randomUUID().slice(0, 8);
    const testMode = process.env.VERCEL_ENV !== 'production';
    const subtotal = items.reduce((total, item) => total + item.cents * item.quantity, 0);
    let claimed = false;
    try {
        const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: challenge }),
            signal: AbortSignal.timeout(6000)
        });
        const verified = await check.json();
        if (!verified.success) return res.status(400).json({ error: 'Refaça a verificação de segurança.' });
        if (ledger) {
            try {
                claimed = await ledger.claim({ requestId, digest, orderRef: id });
                if (!claimed) {
                    const known = replayResponse(await ledger.lookup(requestId), digest);
                    if (!known) throw new OrderLedgerUnavailable();
                    return res.status(known.httpStatus).json(known.body);
                }
            } catch {
                // Não enviar ao Telegram quando a persistência do pedido não é comprovada.
                return res.status(503).json({ error: 'Não foi possível registrar o pedido com segurança. Contate a loja.' });
            }
        }
        const pdf = await orderPdf({ id, name: name.trim(), phone, items, subtotal, money, fulfillment: delivery, testMode });
        const form = new FormData();
        form.set('chat_id', TELEGRAM_CHAT_ID);
        form.set('caption', `${testMode ? 'TESTE - NAO PREPARAR!\n' : ''}Pré-pedido #${id} · ${name.trim()} · ${{delivery:'Entrega',pickup:'Retirada',table:'Mesa'}[method]} · ${money(subtotal)}
Aguardando confirmação da loja.`);
        form.set('document', new Blob([pdf], { type: 'application/pdf' }), `${testMode ? 'TESTE-nao-preparar-' : 'pre-pedido-'}${id}.pdf`);
        const sent = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(8000)
        });
        const telegram = await sent.json();
        if (!sent.ok || !telegram.ok) throw new Error('Telegram indisponível');
        if (ledger) {
            try {
                await ledger.finish(requestId, 'delivered', telegram.result?.message_id);
            } catch {
                // Telegram pode ter recebido; não reexecutar o efeito externo.
                return res.status(202).json({ id, pending: true,
                    error: 'A loja pode ter recebido o pedido, mas não foi possível confirmar o registro. Não reenvie.' });
            }
        }
        return res.status(200).json({ id, test: testMode });
    } catch {
        if (claimed) {
            // Falhas e timeouts do Telegram são ambíguos. Nunca tentar novamente automaticamente.
            try { await ledger.finish(requestId, 'needs_review'); } catch { /* Reconciliação manual. */ }
            return res.status(202).json({ id, pending: true,
                error: 'Não foi possível confirmar o envio. Consulte a loja e não envie novamente.' });
        }
        return res.status(502).json({ error: 'Não foi possível confirmar o envio. Fale com a loja antes de reenviar.' });
    }
};
