// Regras compartilhadas pelo checkout e pelo servidor.
// Não há cálculo de frete: a loja confirma o valor após receber o pré-pedido.
const tidy = (value, max) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1)
    : '';
const valid = (value, min, max) => value.length >= min && value.length <= max;
const readable = (value, min, max, label) => {
    const s = tidy(value, max);
    if (!valid(s, min, max)) throw new Error('Confira ' + label + '.');
    return s;
};

export function normalizeFulfillment(raw, areas) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Escolha entrega, retirada ou consumo no local.');
    }
    const type = raw.type;
    if (!['delivery', 'pickup', 'table'].includes(type)) {
        throw new Error('Escolha entrega, retirada ou consumo no local.');
    }
    if (type !== 'delivery') {
        if (raw.latitude != null || raw.longitude != null) {
            throw new Error('Localização GPS deve ser enviada apenas em entregas.');
        }
        return type === 'pickup'
            ? { type: 'pickup' }
            : { type: 'table', table: readable(raw.table, 1, 12, 'a mesa ou comanda') };
    }
    const city = raw.city;
    if (!['Nova Hartz', 'Araricá'].includes(city)) {
        throw new Error('Selecione Nova Hartz ou Araricá para a entrega.');
    }
    const listed = areas?.cities?.[city];
    if (!Array.isArray(listed)) throw new Error('Não conseguimos validar os bairros. Atualize o cardápio.');
    const selected = readable(raw.neighborhood, 1, 100, 'o bairro');
    const neighborhood = selected === '__other__'
        ? readable(raw.otherNeighborhood, 3, 80, 'a localidade')
        : (listed.some(area => area.name === selected) ? selected : null);
    if (!neighborhood) throw new Error('Selecione um bairro válido ou a opção Outro bairro/localidade.');
    const street = readable(raw.street, 3, 120, 'a rua ou estrada');
    const number = readable(raw.number, 1, 20, 'o número (ou S/N)');
    const complement = tidy(raw.complement, 100);
    const reference = tidy(raw.reference, 140);
    if (complement.length > 100 || reference.length > 140) {
        throw new Error('Complemento ou referência muito longo.');
    }
    const latitudePresent = raw.latitude !== undefined && raw.latitude !== null && raw.latitude !== '';
    const longitudePresent = raw.longitude !== undefined && raw.longitude !== null && raw.longitude !== '';
    if (latitudePresent !== longitudePresent) throw new Error('Localização GPS incompleta.');
    let location = null;
    if (latitudePresent) {
        const latitude = Number(raw.latitude), longitude = Number(raw.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new Error('Coordenadas GPS inválidas.');
        }
        location = { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
    }
    return { type: 'delivery', city, neighborhood, street, number, complement, reference, location };
}

export function describeFulfillment(fulfillment) {
    if (fulfillment?.type === 'pickup') return [
        'Modalidade: Retirada no estabelecimento', 'Taxa de entrega: não se aplica'
    ];
    if (fulfillment?.type === 'table') return [
        'Modalidade: Consumo no local', 'Mesa/comanda: ' + fulfillment.table,
        'Taxa de entrega: não se aplica'
    ];
    if (fulfillment?.type !== 'delivery') throw new Error('Modalidade não informada.');
    const parts = [
        'Modalidade: Entrega',
        'Cidade: ' + fulfillment.city + '/RS',
        'Bairro/localidade: ' + fulfillment.neighborhood,
        'Endereço: ' + fulfillment.street + ', ' + fulfillment.number
    ];
    if (fulfillment.complement) parts.push('Complemento: ' + fulfillment.complement);
    if (fulfillment.reference) parts.push('Referência: ' + fulfillment.reference);
    if (fulfillment.location) parts.push('Localização GPS: https://www.google.com/maps?q=' +
        fulfillment.location.latitude + ',' + fulfillment.location.longitude);
    parts.push('Taxa de entrega: A CONFIRMAR PELA LOJA',
        'O valor do frete e o total serão informados pela loja na confirmação do pedido.');
    return parts;
}
