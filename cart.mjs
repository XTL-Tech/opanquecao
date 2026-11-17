import { money, orderOptions, priceOrder, extraOptions, extraSummary, flavorChoices } from './order-catalog.mjs';

const byId = id => document.getElementById(id);
const cart = [];
let catalog;
let widget;
let challenge;
let sending = false;
let digitalAvailable = false;
let areaUiReady = false;

const storageKey = 'disk-panquecao-cart-v1';
let feedbackTimer;
function initializeCatalog(data) {
    catalog = data;
    try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey));
        if (saved?.version === 1 && Date.now() - saved.updatedAt < 86400000 && saved.lines?.length) {
            const restored = priceOrder(catalog, saved.lines);
            cart.push(...restored);
        }
    } catch { /* Invalid or unavailable storage never blocks ordering. */ }
    refresh();
}
document.addEventListener('menu-ready', event => initializeCatalog(event.detail));
if (window.menuCatalog) initializeCatalog(window.menuCatalog);

function refresh() {
    try { window.localStorage.setItem(storageKey, JSON.stringify({version: 1, updatedAt: Date.now(), lines: cart})); } catch {}
    // Allow visual inspection of the checkout when integrations are offline;
    // the send button stays disabled until Turnstile issues a challenge.
    byId('checkout').hidden = !cart.length;
    byId('orderUnavailable').hidden = digitalAvailable || !cart.length;
    const rows = byId('cartLines');
    rows.replaceChildren();
    let total = 0;
    for (const [index, line] of cart.entries()) {
        total += line.cents * line.quantity;
        const row = document.createElement('div');
        row.className = 'cart-line';
        const info = document.createElement('div');
        info.className = 'cart-item-info';
        const title = document.createElement('h3');
        title.textContent = line.product;
        const option = document.createElement('p');
        option.className = 'cart-option';
        option.textContent = line.option === 'Único' ? 'Por unidade' : 'Opção: ' + line.option;
        const price = document.createElement('strong');
        price.className = 'cart-item-price';
        price.textContent = money(line.cents * line.quantity);
        info.append(title, option, price);
        if (line.flavors?.length === 2) {
            for (const [i, flavor] of line.flavors.entries()) {
                const detail = document.createElement('p');
                detail.className = 'cart-note';
                detail.textContent = 'Sabor ' + (i + 1) + ': ' + flavor;
                info.append(detail);
            }
        }
        for (const description of extraSummary(line)) {
            const extra = document.createElement('p'); extra.className = 'cart-note'; extra.textContent = description; info.append(extra);
        }
        if (line.note) {
            const note = document.createElement('p');
            note.className = 'cart-note';
            note.textContent = 'Observação: ' + line.note;
            info.append(note);
        }
        const controls = document.createElement('div');
        controls.className = 'cart-item-controls';
        const stepper = document.createElement('div');
        stepper.className = 'cart-stepper';
        const count = document.createElement('span');
        count.textContent = line.quantity;
        count.setAttribute('aria-label', 'Quantidade: ' + line.quantity);
        for (const [delta, label, text] of [[-1, 'Diminuir', '−'], [1, 'Aumentar', '+']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.setAttribute('aria-label', label + ' quantidade de ' + line.product);
            button.disabled = sending || (delta < 0 ? line.quantity <= 1 : line.quantity >= 10);
            button.onclick = () => {
                line.quantity += delta;
                refresh();
                const updated = rows.children[index]?.querySelectorAll('.cart-stepper button');
                const preferred = updated?.[delta < 0 ? 0 : 1];
                (preferred?.disabled ? updated[delta < 0 ? 1 : 0] : preferred)?.focus({ preventScroll: true });
            };
            stepper.append(button);
            if (delta < 0) stepper.append(count);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'cart-remove';
        remove.textContent = 'Remover';
        remove.setAttribute('aria-label', 'Remover ' + line.product);
        remove.disabled = sending;
        remove.onclick = () => {
            cart.splice(index, 1);
            refresh();
            (rows.children[Math.min(index, cart.length - 1)]?.querySelector('button') ||
                byId('cartDialog').querySelector('.cart-back')).focus({ preventScroll: true });
        };
        controls.append(stepper, remove);
        row.append(info, controls);
        rows.append(row);
    }
    const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);
    byId('openCart').textContent = 'Ver pedido · ' + quantity + (quantity === 1 ? ' item' : ' itens');
    byId('cartCount').textContent = quantity ? quantity + (quantity === 1 ? ' item no pedido' : ' itens no pedido') : 'Vamos escolher algo gostoso?';
    byId('cartEmpty').hidden = !!cart.length;
    byId('cartSummary').hidden = !cart.length;
    byId('cartTotal').textContent = money(total);
    if (areaUiReady) updateDeliveryFee();
    byId('sendOrder').disabled = !cart.length || !challenge || sending;

}

byId('menuContent').addEventListener('click', event => {
    const button = event.target.closest('.product-details');
    if (!button || !catalog) return;
    const card = button.closest('.menu-item');
    const category = card.closest('.category-section').id;
    const product = card.dataset.product || card.querySelector('.item-title').textContent;
    const item = catalog.categorias.find(entry => entry.id === category)?.itens.find(entry => entry.nome === product);
    if (!item) return;
    const options = orderOptions(item).filter(option => !card.dataset.option || option.label === card.dataset.option);
    if (!options.length) {
        const contact = document.createElement('a');
        contact.className = 'cart-whatsapp';
        contact.href = 'https://wa.me/5551997383849?text=' + encodeURIComponent('Olá! Quero consultar as opções de ' + product);
        contact.textContent = 'Consultar opções no WhatsApp';
        contact.target = '_blank'; contact.rel = 'noopener noreferrer';
        byId('productDialogContent').append(contact);
        return;
    }
    const form = document.createElement('form');
    form.className = 'order-form';
    form.innerHTML = '<select name="option" hidden aria-hidden="true"></select><fieldset class="option-choices"><legend>Escolha o tamanho ou opção</legend></fieldset>' +
        '<label>Quantidade <input name="quantity" type="number" min="1" max="10" value="1" required></label>' +
        '<label>Observações <textarea name="note" maxlength="160"></textarea></label>' +
        '<button class="order-primary">Adicionar ao carrinho</button><p role="status"></p>';
    for (const option of options) form.elements.option.add(new Option(option.label + ' · ' + money(option.cents), option.label));
    options.forEach((option, index) => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'choice'; radio.value = option.label; radio.checked = index === 0;
        radio.onchange = () => { form.elements.option.value = option.label; updateExtras(); };
        const text = document.createElement('span'); text.textContent = option.label + ' · ' + money(option.cents);
        label.append(radio, text); form.querySelector('fieldset').append(label);
    });
    if (card.dataset.option || options.length === 1) form.querySelector('fieldset').hidden = true;
    // Cada metade deve ser escolhida separadamente, a partir dos sabores
    // cadastrados em panquecas salgadas/doces.
    const choices = flavorChoices(catalog, category, product);
    let flavorSelectors = [];
    if (choices) {
        const flavorsBox = document.createElement('fieldset');
        flavorsBox.className = 'extras-group flavor-choices';
        const legend = document.createElement('legend');
        legend.textContent = 'Escolha os dois sabores';
        flavorsBox.append(legend);
        const help = document.createElement('p');
        help.textContent = 'Selecione um sabor para cada metade da panqueca.';
        flavorsBox.append(help);
        flavorSelectors = choices.map((choice, index) => {
            const label = document.createElement('label');
            label.textContent = choice.label;
            const select = document.createElement('select');
            select.name = 'flavor' + (index + 1);
            select.required = true;
            const placeholder = new Option('Selecione um sabor', '');
            placeholder.disabled = true;
            select.add(placeholder);
            for (const flavor of choice.options) select.add(new Option(flavor, flavor));
            select.value = '';
            select.addEventListener('change', () => {
                const values = flavorSelectors.map(field => field.value);
                formStatus.textContent = values.every(Boolean) && values[0] === values[1]
                    ? 'Escolha dois sabores diferentes.' : '';
            });
            label.append(select);
            flavorsBox.append(label);
            return select;
        });
        form.querySelector('fieldset').after(flavorsBox);
    }
    const extrasBox = document.createElement('div'); extrasBox.className = 'extras-box';
    form.querySelector('fieldset').after(extrasBox);
    const freeSelected = new Set();
    const paidSelected = new Set();
    const formStatus = form.querySelector('[role=status]');
    const submitButton = form.querySelector('.order-primary');
    function updateExtras() {
        const extras = extraOptions(item, form.elements.option.value);
        extrasBox.replaceChildren();
        if (extras.free.length) {
            const fieldset = document.createElement('fieldset'); fieldset.className = 'extras-group';
            const legend = document.createElement('legend');
            legend.textContent = 'Complementos grátis · ' + freeSelected.size + ' de ' + extras.limit;
            fieldset.append(legend);
            const help = document.createElement('p'); help.textContent = 'Escolha até ' + extras.limit + ' por unidade. Você pode escolher menos.';
            fieldset.append(help);
            for (const name of extras.free) {
                const label = document.createElement('label'); const input = document.createElement('input');
                input.type = 'checkbox'; input.name = 'freeExtra'; input.value = name; input.checked = freeSelected.has(name);
                input.disabled = !input.checked && freeSelected.size >= extras.limit;
                input.onchange = () => { input.checked ? freeSelected.add(name) : freeSelected.delete(name); updateExtras(); focusExtra('freeExtra', name); };
                label.append(input, document.createTextNode(name)); fieldset.append(label);
            }
            extrasBox.append(fieldset);
        }
        if (extras.paid.length) {
            const fieldset = document.createElement('fieldset'); fieldset.className = 'extras-group';
            const legend = document.createElement('legend'); legend.textContent = 'Adicionais pagos · opcionais'; fieldset.append(legend);
            for (const extra of extras.paid) {
                const label = document.createElement('label'); const input = document.createElement('input');
                input.type = 'checkbox'; input.name = 'paidExtra'; input.value = extra.label; input.checked = paidSelected.has(extra.label);
                input.onchange = () => { input.checked ? paidSelected.add(extra.label) : paidSelected.delete(extra.label); updateExtras(); focusExtra('paidExtra', extra.label); };
                label.append(input, document.createTextNode(extra.label.replace('Adicional de ', '') + ' · + ' + money(extra.cents) + ' / unidade'));
                fieldset.append(label);
            }
            extrasBox.append(fieldset);
        }
        const tooMany = freeSelected.size > extras.limit;
        submitButton.disabled = tooMany;
        formStatus.textContent = tooMany ? 'Este tamanho permite ' + extras.limit + ' grátis. Desmarque ' + (freeSelected.size - extras.limit) + ' para continuar.' : '';
        const base = options.find(option => option.label === form.elements.option.value).cents;
        const additional = extras.paid.filter(extra => paidSelected.has(extra.label)).reduce((sum, extra) => sum + extra.cents, 0);
        const quantity = form.elements.quantity.valueAsNumber;
        submitButton.textContent = '+ Adicionar · ' + money((base + additional) * (Number.isInteger(quantity) && quantity > 0 ? quantity : 1));
    }
    function focusExtra(group, value) {
        [...form.querySelectorAll('input[type=checkbox]')].find(input => input.name === group && input.value === value)?.focus({preventScroll: true});
    }
    form.elements.quantity.oninput = updateExtras;
    updateExtras();
    form.onsubmit = event => {
        event.preventDefault();
        const selected = options.find(option => option.label === form.elements.option.value);
        if (!selected || cart.length >= 25) {
            form.querySelector('[role=status]').textContent = 'O carrinho atingiu o limite de itens.';
            return;
        }
        try {
            const [line] = priceOrder(catalog, [{ category, product, option: selected.label,
                quantity: form.elements.quantity.valueAsNumber, note: form.elements.note.value.trim(),
                flavors: flavorSelectors.map(select => select.value),
                freeExtras: [...freeSelected], paidExtras: [...paidSelected] }]);
            cart.push(line);
        } catch (error) { formStatus.textContent = error.message; return; }
        refresh();
        byId('productDialog').close();
        button.focus({ preventScroll: true });
        byId('cartFeedback').textContent = '✓ ' + product + ' adicionado ao pedido';
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => { byId('cartFeedback').textContent = ''; }, 3500);
    };
    byId('productDialogContent').append(form);
});

const checkoutForm = byId('checkout');
const orderStatus = byId('orderStatus');
let lastInvalidInput = null;
function fieldLabel(field) {
    if (!field) return 'campo obrigatório';
    if (field.name === 'consent') return 'autorização de contato';
    return field.closest('label')?.firstChild?.textContent?.trim()?.replace(/\s*\*\s*/g, ' ').slice(0,80) ||
        ({name:'nome', phone:'WhatsApp', city:'cidade', neighborhood:'bairro', street:'rua',
            number:'número', table:'mesa'})[field.name] || 'campo obrigatório';
}
// O Safari impede o evento submit quando algum campo está inválido.
// Mostrar o motivo evita a impressão de que o botão está sem funcionar.
checkoutForm.addEventListener('invalid', event => {
    const field = event.target;
    if (lastInvalidInput === field) return;
    lastInvalidInput = field;
    orderStatus.textContent = 'Preencha ou corrija: ' + fieldLabel(field) + '. O pedido ainda NÃO foi enviado.';
    field.setAttribute('aria-invalid', 'true');
}, true);
checkoutForm.addEventListener('input', event => {
    if (event.target?.matches?.('input, select, textarea')) {
        event.target.removeAttribute('aria-invalid');
        if (lastInvalidInput === event.target) lastInvalidInput = null;
    }
});
let deliveryAreas;
let deliveryAreasRequest;
const deliveryCity = byId('deliveryCity');
const deliveryNeighborhood = byId('deliveryNeighborhood');
const otherNeighborhood = byId('otherNeighborhood');
const notListedValue = '__other__';
const deliveryFields = ['city', 'neighborhood', 'street', 'number'];
let estimates = {};

async function loadDeliveryAreas() {
    if (deliveryAreas) return;
    deliveryAreasRequest ??= fetch('/delivery-areas.json', { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar as áreas de entrega.');
        const data = await response.json();
        if (!data || !data.cities || !Array.isArray(data.cities['Nova Hartz']) || !Array.isArray(data.cities['Araricá'])) {
            throw new Error('Cadastro de bairros indisponível.');
        }
        deliveryAreas = data;
        deliveryCity.replaceChildren(new Option('Selecione a cidade', ''));
        for (const city of Object.keys(data.cities)) {
            deliveryCity.add(new Option(city, city));
        }
        updateNeighborhoodList();
    }).catch(error => { deliveryAreasRequest = undefined; throw error; });
    await deliveryAreasRequest;
}
function updateNeighborhoodList() {
    deliveryNeighborhood.replaceChildren(new Option('Selecione o bairro', ''));
    const areas = deliveryAreas?.cities?.[deliveryCity.value] || [];
    for (const area of areas) deliveryNeighborhood.add(new Option(area.name, area.name));
    if (areas.length) deliveryNeighborhood.add(new Option('Outro bairro / localidade', notListedValue));
    deliveryNeighborhood.disabled = !areas.length;
    updateDeliveryFee();
}
function updateDeliveryFee() {
    const isDelivery = selectedFulfillment() === 'delivery';
    const another = isDelivery && deliveryNeighborhood.value === notListedValue;
    byId('otherNeighborhoodLabel').hidden = !another;
    otherNeighborhood.required = another;
    if (!another) otherNeighborhood.value = '';
    const area = deliveryAreas?.cities?.[deliveryCity.value]?.find(row => row.name === deliveryNeighborhood.value);
    // Bairros cadastrados herdam o padrão municipal; localidades fora da lista
    // continuam sujeitas à confirmação de cobertura e taxa pela loja.
    const rate = area ? (area.feeCents ?? deliveryAreas?.defaultFeeCents?.[deliveryCity.value]) : null;
    const fee = isDelivery && Number.isSafeInteger(rate) && rate >= 0 && rate <= 10000 ? rate : null;
    byId('deliveryFeeStatus').textContent = fee === null
        ? 'Taxa de entrega: a confirmar pela loja antes de aceitar o pedido. O subtotal não inclui a taxa.'
        : 'Taxa de entrega: ' + money(fee) + '. Total estimado com entrega: ' +
            money(cart.reduce((sum, line) => sum + line.cents * line.quantity, 0) + fee);
}
deliveryCity.addEventListener('change', updateNeighborhoodList);
deliveryNeighborhood.addEventListener('change', updateDeliveryFee);
function selectedFulfillment() {
    return checkoutForm.querySelector('input[name="fulfillment"]:checked')?.value || '';
}
function updateFulfillment() {
    const mode = selectedFulfillment();
    for (const [type, id] of [['delivery', 'fulfillmentDelivery'], ['pickup', 'fulfillmentPickup'], ['table', 'fulfillmentTable']]) {
        byId(id).hidden = type !== mode;
    }
    for (const key of deliveryFields) checkoutForm.elements[key].required = mode === 'delivery';
    checkoutForm.elements.table.required = mode === 'table';
    updateDeliveryFee();
    if (mode !== 'delivery') {
        byId('geoLatitude').value = '';
        byId('geoLongitude').value = '';
        byId('locationStatus').textContent = 'A localização só será solicitada se você tocar no botão. Confirme também o endereço.';
    }
    const minutes = mode === 'delivery' ? estimates.delivery : mode === 'pickup' ? estimates.pickup : null;
    byId('fulfillmentEstimate').textContent = Number.isInteger(minutes) && minutes >= 5 && minutes <= 240
        ? 'Previsão informada pela loja: cerca de ' + minutes + ' minutos, sujeita à confirmação.'
        : mode === 'table' ? 'O atendimento será confirmado pela loja.'
        : 'O prazo será informado pela loja na confirmação.';
}
checkoutForm.querySelectorAll('input[name="fulfillment"]').forEach(radio => {
    radio.addEventListener('change', updateFulfillment);
});
updateFulfillment();
areaUiReady = true;
byId('captureLocation').onclick = () => {
    const status = byId('locationStatus');
    if (selectedFulfillment() !== 'delivery') return;
    if (!navigator.geolocation) {
        status.textContent = 'Seu navegador não oferece localização. Informe o endereço manualmente.';
        return;
    }
    status.textContent = 'Solicitando sua localização, mediante autorização do navegador…';
    navigator.geolocation.getCurrentPosition(position => {
        if (selectedFulfillment() !== 'delivery') return;
        byId('geoLatitude').value = String(position.coords.latitude);
        byId('geoLongitude').value = String(position.coords.longitude);
        status.textContent = 'Localização registrada (precisão aproximada de ' +
            Math.round(position.coords.accuracy || 0) + ' m). Confirme também o endereço.';
    }, () => {
        status.textContent = 'Localização não disponível ou não autorizada. Informe o endereço manualmente.';
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
};

let configPromise;
byId('openCart').onclick = async () => {
    refresh();
    byId('cartDialog').showModal();
    try {
        await loadDeliveryAreas();
    } catch (error) {
        byId('deliveryFeeStatus').textContent = error.message + ' Escolha retirada ou tente novamente.';
    }
    if (widget !== undefined) return;
    try {
        configPromise ??= fetch('/api/order-config').then(response => response.json());
        const { siteKey, testMode, deliveryEstimateMinutes, pickupEstimateMinutes } = await configPromise;
        if (testMode) byId('orderStatus').textContent = 'AMBIENTE DE TESTE: a comanda será enviada ao Telegram da loja com aviso NÃO PREPARAR.';
        estimates = { delivery: deliveryEstimateMinutes, pickup: pickupEstimateMinutes };
        updateFulfillment();
        if (!siteKey || !window.turnstile) throw new Error();
        if (widget !== undefined) return;
        widget = window.turnstile.render('#orderChallenge', {
            sitekey: siteKey,
            callback: token => { challenge = token; refresh(); },
            'expired-callback': () => {
                challenge = undefined;
                orderStatus.textContent = 'Verificação de segurança expirada. Conclua uma nova verificação antes de enviar.';
                refresh();
            },
            'error-callback': () => {
                challenge = undefined;
                orderStatus.textContent = 'O navegador não conseguiu validar a segurança. Recarregue a página e tente novamente. Nenhum pedido foi enviado.';
                refresh();
            }
        });
        digitalAvailable = true;
    } catch {
        configPromise = undefined;
        orderStatus.textContent = 'Não foi possível iniciar a verificação de segurança. Recarregue a página. Nenhum pedido foi enviado.';
    } finally {
        byId('checkout').hidden = !cart.length;
        refresh();
    }
};

byId('checkout').onsubmit = async event => {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const status = orderStatus;
    if (!challenge) {
        status.textContent = 'A verificação de segurança não foi concluída ou expirou. Aguarde e tente novamente. Nenhum pedido foi enviado.';
        return;
    }
    const trace = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    sending = true;
    refresh();
    status.textContent = 'Enviando…';
    try {
        const lines = priceOrder(catalog, cart);
        const response = await fetch('/api/order', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Checkout-Trace': trace },
            body: JSON.stringify({ lines, name: form.elements.name.value,
                phone: form.elements.phone.value.replace(/\D/g, ''), challenge,
                fulfillment: {
                    type: selectedFulfillment(),
                    city: form.elements.city.value,
                    neighborhood: form.elements.neighborhood.value,
                    otherNeighborhood: otherNeighborhood.value.trim(),
                    street: form.elements.street.value.trim(),
                    number: form.elements.number.value.trim(),
                    postalCode: form.elements.postalCode.value.trim(),
                    complement: form.elements.complement.value.trim(),
                    reference: form.elements.reference.value.trim(),
                    table: form.elements.table.value.trim(),
                    latitude: byId('geoLatitude').value || null,
                    longitude: byId('geoLongitude').value || null
                } })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Falha na comunicação com a loja.');
        cart.length = 0;
        form.reset();
        updateNeighborhoodList();
        updateFulfillment();
        status.textContent = result.test
            ? 'TESTE #' + result.id + ' enviado ao grupo da loja. NÃO PREPARAR. Nenhum pedido real foi realizado.'
            : 'Solicitação #' + result.id + ' enviada à loja. Aguarde a confirmação pelo WhatsApp informado.';
    } catch (error) {
        status.textContent = 'Não foi possível confirmar o envio (código ' + trace +
            '). ' + (error?.message || 'Erro de comunicação.') +
            ' Antes de reenviar, confirme no Telegram com a loja para evitar pedidos duplicados.';
    } finally {
        sending = false;
        challenge = undefined;
        if (widget !== undefined && window.turnstile) window.turnstile.reset(widget);
        refresh();
    }
};
