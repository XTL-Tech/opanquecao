import { money, orderOptions, priceOrder, extraOptions, extraSummary } from './order-catalog.mjs';

const byId = id => document.getElementById(id);
const cart = [];
let catalog;
let widget;
let challenge;
let sending = false;
let digitalAvailable = false;

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
    if (card.dataset.option) form.querySelector('fieldset').hidden = true;
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
let estimates = {};
function selectedFulfillment() {
    return checkoutForm.querySelector('input[name="fulfillment"]:checked')?.value || '';
}
function updateFulfillment() {
    const mode = selectedFulfillment();
    for (const [type, id] of [['delivery', 'fulfillmentDelivery'], ['pickup', 'fulfillmentPickup'], ['table', 'fulfillmentTable']]) {
        byId(id).hidden = type !== mode;
    }
    checkoutForm.elements.address.required = mode === 'delivery';
    checkoutForm.elements.table.required = mode === 'table';
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

const pendingOrderKey = 'disk-panquecao-order-intent-v1';
let fallbackAttempt;
function freshRequestId() {
    const bytes = new Uint8Array(16);
    if (!window.crypto?.getRandomValues) throw new Error('Este navegador não permite criar um identificador seguro de pedido.');
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
}
async function getRequestId(payload) {
    // Turnstile é descartado da assinatura; não persistir nome, telefone ou endereço.
    const { challenge: ignored, ...orderData } = payload;
    const serialized = JSON.stringify(orderData);
    let fingerprint;
    try {
        if (window.crypto?.subtle) {
            const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
            fingerprint = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
        }
    } catch { /* Ambiente sem WebCrypto sutil usa somente memória. */ }
    if (fingerprint) {
        try {
            const previous = JSON.parse(window.sessionStorage.getItem(pendingOrderKey));
            if (previous?.fingerprint === fingerprint && Date.now() - previous.time < 1800000 &&
                /^[0-9a-f-]{36}$/i.test(previous.id)) return previous.id;
        } catch {}
        const id = freshRequestId();
        try { window.sessionStorage.setItem(pendingOrderKey,
            JSON.stringify({ id, fingerprint, time: Date.now() })); } catch {}
        return id;
    }
    if (fallbackAttempt?.serialized === serialized) return fallbackAttempt.id;
    fallbackAttempt = { serialized, id: freshRequestId() };
    return fallbackAttempt.id;
}

let configPromise;
byId('openCart').onclick = async () => {
    refresh();
    byId('cartDialog').showModal();
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
            'expired-callback': () => { challenge = undefined; refresh(); },
            'error-callback': () => { challenge = undefined; refresh(); }
        });
        digitalAvailable = true;
    } catch {
        configPromise = undefined;
        byId('orderStatus').textContent = '';
    } finally {
        byId('checkout').hidden = !cart.length;
        refresh();
    }
};

byId('checkout').onsubmit = async event => {
    event.preventDefault();
    if (sending || !challenge) return;
    const form = event.currentTarget;
    const status = byId('orderStatus');
    sending = true;
    refresh();
    status.textContent = 'Enviando…';
    try {
        const lines = priceOrder(catalog, cart);
        const payload = { lines, name: form.elements.name.value,
            phone: form.elements.phone.value.replace(/\D/g, ''), challenge,
            fulfillment: {
                type: selectedFulfillment(),
                address: form.elements.address.value.trim(),
                table: form.elements.table.value.trim(),
                latitude: byId('geoLatitude').value || null,
                longitude: byId('geoLongitude').value || null
            } };
        payload.requestId = await getRequestId(payload);
        const response = await fetch('/api/order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.status === 202 || result.pending) {
            status.textContent = (result.error || 'Pedido aguardando conferência.') +
                ' Referência #' + (result.id || 'indisponível') + '. Consulte a loja pelo WhatsApp.';
            return;
        }
        if (!response.ok) throw new Error(result.error);
        fallbackAttempt = undefined;
        try { window.sessionStorage.removeItem(pendingOrderKey); } catch {}
        cart.length = 0;
        form.reset();
        updateFulfillment();
        status.textContent = result.test
            ? 'TESTE #' + result.id + ' enviado ao grupo da loja. NÃO PREPARAR. Nenhum pedido real foi realizado.'
            : 'Solicitação #' + result.id + ' enviada à loja. Aguarde a confirmação pelo WhatsApp informado.';
    } catch (error) {
        status.textContent = 'Confira antes de reenviar. ' + error.message;
    } finally {
        sending = false;
        challenge = undefined;
        if (widget !== undefined && window.turnstile) window.turnstile.reset(widget);
        refresh();
    }
};
