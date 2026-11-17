// Métodos de pagamento declarados pelo cliente. Não processa cobranças.
// Um PSP como Asaas será integrado apenas após credenciamento e webhooks validados.
export const PAYMENT_METHODS = Object.freeze({
    cash: 'Dinheiro',
    credit: 'Cartão de crédito',
    debit: 'Cartão de débito',
    pix: 'Pix'
});

export function parseCashAmount(input) {
    const value = String(input ?? '').trim().replace(/^R\$\s*/i, '').trim();
    if (!value) return null;
    const match = /^(\d{1,5})(?:[,.](\d{1,2}))?$/.exec(value);
    if (!match) throw new Error('Informe o valor do troco em reais, como 50 ou 50,00.');
    const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1000000) {
        throw new Error('Informe um valor de troco entre R$ 0,01 e R$ 10.000,00.');
    }
    return cents;
}

// Recalcular o valor total no servidor. Nenhum campo de pagamento do
// navegador representa transação paga, autorização de cartão ou Pix recebido.
export function validatePayment(payment, amountDueCents, totalIsKnown = true) {
    const method = payment?.method;
    if (typeof method !== 'string' || !Object.hasOwn(PAYMENT_METHODS, method)) {
        throw new Error('Escolha dinheiro, crédito, débito ou Pix.');
    }
    if (!Number.isSafeInteger(amountDueCents) || amountDueCents < 0) {
        throw new Error('Valor do pedido inválido.');
    }
    const supplied = payment?.changeForCents ?? null;
    if (method !== 'cash' && supplied !== null) {
        throw new Error('Troco só pode ser solicitado no pagamento em dinheiro.');
    }
    if (method === 'cash' && supplied !== null &&
        (!Number.isSafeInteger(supplied) || supplied < amountDueCents || supplied > 1000000)) {
        throw new Error('O valor para troco deve ser igual ou maior que o total do pedido.');
    }
    return {
        method,
        label: PAYMENT_METHODS[method],
        changeForCents: method === 'cash' ? supplied : null,
        changeCents: method === 'cash' && supplied !== null && totalIsKnown
            ? supplied - amountDueCents : null,
        status: 'pending',
        provider: 'manual'
    };
}
