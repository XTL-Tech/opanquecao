export const money = cents => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
}).format(cents / 100);

export function orderOptions(item) {
    const options = item.tamanhos
        ? Object.entries(item.tamanhos)
        : item.tamanhos_acai
            ? item.tamanhos_acai.filter(option => /^\d+ml$/i.test(option.tamanho))
                .map(option => [option.tamanho, option.preco])
            : [['Único', item.preco]];
    return options.flatMap(([label, price]) => {
        const match = /^R\$\s*(\d+),(\d{2})$/.exec(price);
        return match ? [{ label, cents: Number(match[1]) * 100 + Number(match[2]) }] : [];
    });
}

// Extra groups derive from approved catalog data; no inferred prices.
export function extraOptions(item, option) {
    if (!item.tamanhos_acai) return { limit: 0, free: [], paid: [] };
    const size = item.tamanhos_acai.find(entry => entry.tamanho === option);
    const limit = Number(/^(\d+) complementos grátis$/.exec(size?.obs)?.[1] || 0);
    const paid = item.tamanhos_acai.filter(entry => entry.obs === 'Adicional pago').flatMap(entry => {
        const match = /^R\$\s*(\d+),(\d{2})$/.exec(entry.preco);
        return match ? [{ label: entry.tamanho, cents: Number(match[1]) * 100 + Number(match[2]) }] : [];
    });
    return { limit, free: item.tags || [], paid };
}

export function extraSummary(line) {
    return [line.freeExtras?.length ? 'Complementos grátis: ' + line.freeExtras.join(', ') : '',
        line.paidExtras?.length ? 'Adicionais pagos: ' + line.paidExtras.join(', ') : ''].filter(Boolean);
}

export function priceOrder(catalog, lines) {
    if (!Array.isArray(lines) || !lines.length || lines.length > 25) throw new Error('Carrinho inválido.');
    return lines.map(line => {
        const item = catalog.categorias.find(category => category.id === line?.category)
            ?.itens.find(item => item.nome === line.product);
        const option = item && orderOptions(item).find(option => option.label === line.option);
        if (!option || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10 ||
            typeof line.note !== 'string' || line.note.length > 160) {
            throw new Error('Confira as opções e quantidades do carrinho.');
        }
        const extras = extraOptions(item, option.label);
        const freeExtras = line.freeExtras ?? [];
        const paidExtras = line.paidExtras ?? [];
        const valid = (selected, allowed, max) => Array.isArray(selected) && selected.length <= max &&
            new Set(selected).size === selected.length && selected.every(name => typeof name === 'string' && allowed.includes(name));
        if (!valid(freeExtras, extras.free, extras.limit) || !valid(paidExtras, extras.paid.map(extra => extra.label), extras.paid.length)) {
            throw new Error('Confira os complementos e adicionais do produto.');
        }
        const extraCents = paidExtras.reduce((total, name) => total + extras.paid.find(extra => extra.label === name).cents, 0);
        return { category: line.category, product: item.nome, option: option.label, quantity: line.quantity,
            note: line.note.trim(), freeExtras, paidExtras, cents: option.cents + extraCents };
    });
}
