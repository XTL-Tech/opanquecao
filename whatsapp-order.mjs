import { money, extraSummary } from './order-catalog.mjs';
import { PAYMENT_METHODS, validatePayment } from './payment.mjs';

// Número comercial já publicado no próprio site; não usar números pessoais.
export const STORE_WHATSAPP = '5551997383849';

const clean = (value, limit = 180) => String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

export function buildWhatsAppMessage({ lines, name, phone, fulfillment, payment, deliveryFeeCents = null }) {
    if (!Array.isArray(lines) || !lines.length || lines.length > 25) {
        throw new Error('Adicione pelo menos um produto ao pedido.');
    }
    const customer = clean(name, 80);
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!customer || !/^\d{10,11}$/.test(digits)) {
        throw new Error('Informe seu nome e um WhatsApp válido com DDD.');
    }
    const type = fulfillment?.type;
    if (!['delivery', 'pickup', 'table'].includes(type)) {
        throw new Error('Escolha entrega, retirada ou atendimento na mesa.');
    }
    const itemsSubtotal = lines.reduce((sum, line) => {
        if (!line || !Number.isSafeInteger(line.cents) || line.cents < 0 ||
            !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10) {
            throw new Error('Confira os itens e valores do carrinho.');
        }
        return sum + line.cents * line.quantity;
    }, 0);
    if (!Number.isSafeInteger(itemsSubtotal)) throw new Error('Valor do carrinho inválido.');
    let fee = null;
    if (type === 'delivery') {
        if (!['Nova Hartz', 'Araricá'].includes(fulfillment.city) ||
            !clean(fulfillment.neighborhood, 80) || !clean(fulfillment.street, 120) ||
            !clean(fulfillment.number, 20)) {
            throw new Error('Informe cidade, bairro, rua e número para entrega.');
        }
        if (deliveryFeeCents !== null &&
            (!Number.isSafeInteger(deliveryFeeCents) || deliveryFeeCents < 0 || deliveryFeeCents > 10000)) {
            throw new Error('Taxa de entrega inválida.');
        }
        fee = deliveryFeeCents;
    } else if (type === 'table' && !clean(fulfillment.table, 12)) {
        throw new Error('Informe o número ou identificação da mesa.');
    }
    const totalKnown = type !== 'delivery' || fee !== null;
    const total = itemsSubtotal + (fee ?? 0);
    const paymentInfo = validatePayment(payment, total, totalKnown);
    const parts = [
        '*PRÉ-PEDIDO | DISK PANQUECÃO*',
        'Enviado pelo cardápio online. Aguardando confirmação da loja.',
        '',
        '*CLIENTE*',
        'Nome: ' + customer,
        'WhatsApp: ' + digits,
        '',
        '*RECEBIMENTO*'
    ];
    if (type === 'delivery') {
        const neighborhood = fulfillment.neighborhood === '__other__'
            ? clean(fulfillment.otherNeighborhood, 80)
            : clean(fulfillment.neighborhood, 80);
        if (!neighborhood) throw new Error('Informe o nome do bairro ou localidade.');
        parts.push('Entrega em: ' + clean(fulfillment.city, 40) + '/RS',
            'Bairro/localidade: ' + neighborhood,
            'Endereço: ' + clean(fulfillment.street, 120) + ', ' + clean(fulfillment.number, 20));
        for (const [label, key, max] of [
            ['Complemento', 'complement', 100],
            ['CEP', 'postalCode', 9],
            ['Referência', 'reference', 140]
        ]) {
            if (clean(fulfillment[key], max)) parts.push(label + ': ' + clean(fulfillment[key], max));
        }
        const latitude = Number(fulfillment.latitude), longitude = Number(fulfillment.longitude);
        if (fulfillment.latitude != null && fulfillment.latitude !== '' &&
            fulfillment.longitude != null && fulfillment.longitude !== '' &&
            Number.isFinite(latitude) && Number.isFinite(longitude) &&
            latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
            parts.push('Localização: https://www.google.com/maps?q=' + latitude + ',' + longitude);
        }
    } else if (type === 'pickup') {
        parts.push('Retirada no estabelecimento');
    } else {
        parts.push('Consumo no local', 'Mesa: ' + clean(fulfillment.table, 12));
    }
    parts.push('', '*ITENS*');
    lines.forEach((line, i) => {
        parts.push(String(i + 1) + '. *' + line.quantity + 'x ' + clean(line.product, 160) + '*',
            '   Opção: ' + clean(line.option === 'Único' ? 'Unidade' : line.option, 90),
            '   Valor unitário (com adicionais): ' + money(line.cents),
            '   Total deste item: ' + money(line.cents * line.quantity));
        if (line.flavors?.length === 2) {
            parts.push('   Sabor 1: ' + clean(line.flavors[0], 120),
                '   Sabor 2: ' + clean(line.flavors[1], 120));
        }
        for (const detail of extraSummary(line)) parts.push('   ' + clean(detail, 450));
        if (line.note) parts.push('   Observação: ' + clean(line.note, 160));
    });
    parts.push('', '*VALORES*', 'Subtotal dos itens: ' + money(itemsSubtotal));
    if (type === 'delivery') {
        parts.push(fee === null ? 'Taxa de entrega: A CONFIRMAR PELA LOJA'
            : 'Taxa de entrega: ' + money(fee));
    } else {
        parts.push('Taxa de entrega: não se aplica');
    }
    parts.push(totalKnown ? '*Total estimado: ' + money(total) + '*'
        : '*Total: a confirmar (itens: ' + money(itemsSubtotal) + ' + entrega)*');
    parts.push('', '*PAGAMENTO*', 'Forma: ' + PAYMENT_METHODS[paymentInfo.method]);
    if (paymentInfo.method === 'cash') {
        if (paymentInfo.changeForCents !== null) {
            parts.push('Troco para: ' + money(paymentInfo.changeForCents));
            parts.push(paymentInfo.changeCents === null
                ? 'Troco: a confirmar após definir a taxa de entrega'
                : 'Troco estimado: ' + money(paymentInfo.changeCents));
        } else {
            parts.push('Troco: não solicitado');
        }
    }
    parts.push('', 'Peço confirmação de disponibilidade, prazo, taxa (se pendente) e valor final antes do preparo.');
    return parts.join('\n');
}


/**
 * Produção enxuta: apenas itens e observações. Os demais dados são acertados
 * na conversa, sem pedir nome, telefone, endereço ou pagamento no site.
 */
export function buildSimpleWhatsAppMessage({ lines, note = '' }) {
    if (!Array.isArray(lines) || !lines.length || lines.length > 25) {
        throw new Error('Adicione pelo menos um produto ao pedido.');
    }
    let subtotal = 0;
    const parts = [
        '*PRÉ-PEDIDO | DISK PANQUECÃO*',
        'Olá! Gostaria de pedir estes itens do cardápio:',
        '',
        '*ITENS DO PEDIDO*'
    ];
    lines.forEach((line, index) => {
        if (!line || !Number.isSafeInteger(line.cents) || line.cents < 0 ||
            !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10 ||
            !clean(line.product, 160)) {
            throw new Error('Confira os itens e valores do carrinho.');
        }
        const lineTotal = line.cents * line.quantity;
        if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
            throw new Error('Valor do carrinho inválido.');
        }
        subtotal += lineTotal;
        parts.push((index + 1) + '. *' + line.quantity + 'x ' + clean(line.product, 160) + '*',
            '   Opção: ' + clean(line.option === 'Único' ? 'Unidade' : line.option, 90),
            '   Unitário com adicionais: ' + money(line.cents),
            '   Total do item: ' + money(lineTotal));
        if (line.flavors?.length === 2) {
            parts.push('   Sabor 1: ' + clean(line.flavors[0], 120),
                '   Sabor 2: ' + clean(line.flavors[1], 120));
        }
        for (const detail of extraSummary(line)) parts.push('   ' + clean(detail, 450));
        if (line.note) parts.push('   Observação: ' + clean(line.note, 160));
    });
    const generalNote = clean(note, 400);
    if (generalNote) parts.push('', '*OBSERVAÇÕES GERAIS*', generalNote);
    parts.push('', '*Subtotal dos itens (sem frete): ' + money(subtotal) + '*',
        'Entrega ou retirada, endereço, pagamento e total final: a combinar neste WhatsApp.',
        '',
        'Por favor, confirmem a disponibilidade e o valor final antes de preparar.');
    return parts.join('\n');
}

export function whatsappOrderUrl(message) {
    if (!message || typeof message !== 'string') throw new Error('Não foi possível preparar o pedido.');
    return 'https://wa.me/' + STORE_WHATSAPP + '?text=' + encodeURIComponent(message);
}
