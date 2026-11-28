function estimateMinutes(value) {
    const minutes = Number(value);
    return value && Number.isInteger(minutes) && minutes >= 5 && minutes <= 240 ? minutes : null;
}
module.exports = function handler(req, res) {
    // Somente configuração pública (site key e prazos). Pedidos permanecem sem cache.
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=60');
    if (req.method !== 'GET') return res.status(405).end();
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY } = process.env;
    const siteKey = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && TURNSTILE_SECRET_KEY && TURNSTILE_SITE_KEY;
    return res.json({
        siteKey: siteKey || null,
        deliveryAccountRequired: require('../lib/customer-cpf').enabled(),
        testMode: process.env.VERCEL_ENV !== 'production',
        deliveryEstimateMinutes: estimateMinutes(process.env.ORDER_ESTIMATE_DELIVERY_MIN),
        pickupEstimateMinutes: estimateMinutes(process.env.ORDER_ESTIMATE_PICKUP_MIN)
    });
};
