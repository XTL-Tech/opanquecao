const { loadCatalog, usesSupabaseCatalog } = require('../lib/catalog-source');

module.exports = async function handler(req,res) {
    if (req.method !== 'GET') return res.status(405).json({ error:'Método inválido.' });
    if (!usesSupabaseCatalog()) {
        // Migração ainda não ativada: preservar cardapio.json existente.
        res.setHeader('Location','/cardapio.json');
        res.setHeader('Cache-Control','no-store');
        return res.status(307).end();
    }
    res.setHeader('Cache-Control','no-store');
    try {
        const catalog = await loadCatalog();
        return res.status(200).json(catalog);
    } catch {
        // Nunca apresentar valores antigos como se o catálogo novo estivesse em dia.
        return res.status(503).json({ error:'Cardápio temporariamente indisponível. Tente novamente.' });
    }
};
