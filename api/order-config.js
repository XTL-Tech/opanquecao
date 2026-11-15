module.exports = function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).end();
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY } = process.env;
    const siteKey = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && TURNSTILE_SECRET_KEY && TURNSTILE_SITE_KEY;
    return res.json({ siteKey: siteKey || null });
};
