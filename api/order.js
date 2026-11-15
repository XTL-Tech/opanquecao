const { orderPdf } = require('../lib/order-pdf');
const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido.' });
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY } = process.env;
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TURNSTILE_SECRET_KEY) {
        return res.status(503).json({ error: 'Pedido digital indisponível. Use o WhatsApp.' });
    }
    const { lines, name, phone, challenge } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80 ||
        typeof phone !== 'string' || !/^\d{10,11}$/.test(phone) ||
        typeof challenge !== 'string' || !challenge || challenge.length > 2048) {
        return res.status(400).json({ error: 'Confira seu nome, telefone e a verificação.' });
    }
    const { priceOrder, money } = await import('../order-catalog.mjs');
    let items;
    try {
        const catalog = JSON.parse(await readFile(require('node:path').join(process.cwd(), 'cardapio.json'), 'utf8'));
        items = priceOrder(catalog, lines);
    } catch {
        return res.status(400).json({ error: 'Confira os itens e as opções do carrinho.' });
    }
    const id = randomUUID().slice(0, 8);
    const subtotal = items.reduce((total, item) => total + item.cents * item.quantity, 0);
    try {
        const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: challenge }),
            signal: AbortSignal.timeout(6000)
        });
        const verified = await check.json();
        if (!verified.success) return res.status(400).json({ error: 'Refaça a verificação de segurança.' });
        const pdf = await orderPdf({ id, name: name.trim(), phone, items, subtotal, money });
        const form = new FormData();
        form.set('chat_id', TELEGRAM_CHAT_ID);
        form.set('caption', `Pré-pedido #${id} · ${money(subtotal)}
Aguardando confirmação da loja.`);
        form.set('document', new Blob([pdf], { type: 'application/pdf' }), `pre-pedido-${id}.pdf`);
        const sent = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(8000)
        });
        if (!sent.ok || !(await sent.json()).ok) throw new Error('Telegram indisponível');
        return res.status(200).json({ id });
    } catch {
        return res.status(502).json({ error: 'Não foi possível confirmar o envio. Fale com a loja antes de reenviar.' });
    }
};
