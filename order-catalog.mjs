export const money = cents => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
}).format(cents / 100);

 
// Nome de apresentação: não altera o identificador original do catálogo,
// usado em preços, imagens e validação. As 12 categorias ficam explícitas.
export function orderProductName(line) {
    const name = typeof line?.product === 'string' ? line.product.trim() : '';
    if (!name) return '';
    switch (line.category) {
        case 'panquecas-salgadas': return 'Panqueca salgada sabor ' + name;
        case 'panquecas-doces': return 'Panqueca doce sabor ' + name;
        case 'panquecas-2-sabores': return /^panqueca\b/i.test(name) ? name : 'Panqueca 2 sabores — ' + name;
        case 'lasanhas-de-massa-de-panqueca':
            return /^meio a meio\b/i.test(name)
                ? 'Lasanha (massa de panqueca) — ' + name
                : 'Lasanha sabor ' + name + ' (massa de panqueca)';
        case 'massas': return /^massa\b/i.test(name) ? name : 'Massa sabor ' + name;
        case 'frango-frito-crocrante-no-pote':
            return /^frango frito\b/i.test(name) ? name : 'Frango frito crocante no pote — ' + name;
        case 'paokecao': return 'Pãokecão — ' + name;
        case 'bebidas': return 'Bebida — ' + name;
        case 'cocktails-com-alcool': return 'Coquetel com álcool — ' + name;
        case 'cocktails-sem-alcool': return 'Coquetel sem álcool — ' + name;
        // Açaí e batatas já trazem o tipo de produto no nome cadastrado.
        default: return name;
    }
}


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

// Sabores válidos são derivados do cardápio real: nunca confiar nas opções
// enviadas pelo navegador. Os preços dos três produtos permanecem inalterados.
export function flavorChoices(catalog, category, product) {
    if (category !== 'panquecas-2-sabores') return null;
    const salty = catalog.categorias.find(entry => entry.id === 'panquecas-salgadas')?.itens.map(item => item.nome) || [];
    const sweet = catalog.categorias.find(entry => entry.id === 'panquecas-doces')?.itens.map(item => item.nome) || [];
    if (product === 'Panqueca Meio a Meio (2 Sabores Salgados)') {
        return [{ label: '1º sabor salgado', options: salty }, { label: '2º sabor salgado', options: salty }];
    }
    if (product === 'Panqueca Meio a Meio (2 Sabores Doces)') {
        return [{ label: '1º sabor doce', options: sweet }, { label: '2º sabor doce', options: sweet }];
    }
    if (product === 'Panqueca Meio a Meio (Salgada e Doce)') {
        return [{ label: 'Sabor salgado', options: salty }, { label: 'Sabor doce', options: sweet }];
    }
    return null;
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
        const choices = flavorChoices(catalog, line.category, item.nome);
        const flavors = line.flavors ?? [];
        if (choices) {
            if (!Array.isArray(flavors) || flavors.length !== 2 ||
                !choices.every((choice, i) => typeof flavors[i] === 'string' && choice.options.includes(flavors[i])) ||
                flavors[0] === flavors[1]) {
                throw new Error('Escolha dois sabores válidos e diferentes para a panqueca.');
            }
        } else if (!Array.isArray(flavors) || flavors.length) {
            throw new Error('Este produto não permite seleção de sabores.');
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
            note: line.note.trim(), flavors: choices ? [...flavors] : [], freeExtras, paidExtras,
            cents: option.cents + extraCents };
    });
}
