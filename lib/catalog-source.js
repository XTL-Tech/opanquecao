const { readFile } = require('node:fs/promises');
const path = require('node:path');

class CatalogUnavailableError extends Error {
    constructor() {
        super('O catálogo está temporariamente indisponível.');
        this.name = 'CatalogUnavailableError';
    }
}
function usesSupabaseCatalog() {
    return process.env.CATALOG_SOURCE === 'supabase';
}
async function loadCatalog() {
    if (process.env.CATALOG_SOURCE === 'neon') {
        try {
            const {getCatalog}=require('./backoffice-neon');
            const item=await getCatalog();
            if (!Array.isArray(item?.catalog?.categorias) || !item.catalog.categorias.length) throw Error('incomplete');
            return item.catalog;
        } catch { throw new CatalogUnavailableError(); }
    }
    if (!usesSupabaseCatalog()) {
        return JSON.parse(await readFile(path.join(process.cwd(), 'cardapio.json'), 'utf8'));
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
        throw new CatalogUnavailableError();
    }
    try {
        const response = await fetch(url +
            '/rest/v1/restaurant_catalogs?select=catalog&restaurant_id=eq.opanquecao&limit=1', {
            method:'GET',
            cache:'no-store',
            headers: { apikey:key, Accept:'application/json' },
            signal: AbortSignal.timeout(7500)
        });
        if (!response.ok) throw new CatalogUnavailableError();
        const rows = await response.json();
        const catalog = rows?.[0]?.catalog;
        if (!Array.isArray(catalog?.categorias) || catalog.categorias.length === 0) {
            throw new CatalogUnavailableError();
        }
        return catalog;
    } catch {
        throw new CatalogUnavailableError();
    }
}

module.exports = { loadCatalog, usesSupabaseCatalog, CatalogUnavailableError };
