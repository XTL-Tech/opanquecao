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
        return { ...line, cents: option.cents };
    });
}
