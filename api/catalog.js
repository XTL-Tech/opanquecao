const { loadCatalog, usesSupabaseCatalog } = require('../lib/catalog-source');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método inválido.' });

    // Só o catálogo em arquivo pode ser cacheado na CDN. O modo Supabase
    // permanece fail-closed e sem cache até existir publicação/versão atômica.
    const fromDb = usesSupabaseCatalog();
    res.setHeader('Cache-Control', fromDb
        ? 'no-store'
        : 'public, max-age=30, s-maxage=300, stale-while-revalidate=60');
    try {
        // Responder 200 diretamente evita o 307 e a segunda requisição ao JSON.
        const catalog = await loadCatalog();
        return res.status(200).json(catalog);
    } catch {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).json({ error: 'Cardápio temporariamente indisponível. Tente novamente.' });
    }
};
