import { accountRequest } from './customer-account-client.mjs';
import { money, orderOptions, priceOrder, extraOptions, extraSummary, flavorChoices, orderProductName } from './order-catalog.mjs';
import { buildSimpleWhatsAppMessage, whatsappOrderUrl } from './whatsapp-order.mjs';
import { normalizeFulfillment } from './fulfillment.mjs';

const byId = id => document.getElementById(id);
const cart = [];
let catalog;
let sending = false;
let checkoutStep = false;
let lastRegistration = null;
let deepLinkOpened = false;
let checkoutEventSent = false;
const trackedPreOrders = new Set();
const initialStoreStatus = window.storeOperationStatus;
let storeOpenForOrders = !initialStoreStatus?.enabled ||
    (initialStoreStatus.open === true && initialStoreStatus.simulated !== true);

// Eventos Meta somente mediante consentimento. Preço de item é subtotal, não receita realizada.
const trackMeta = (eventName, data) => window.XTLMeta?.track?.(eventName, data) === true;
const productId = line => [line.category, line.product, line.option].join('::');
function productEventData(lines) {
    const valueCents = lines.reduce((sum, line) => sum + line.cents * line.quantity, 0);
    return {
        content_type: 'product',
        content_ids: lines.map(productId),
        contents: lines.map(line => ({
            id: productId(line), quantity: line.quantity, item_price: line.cents / 100
        })),
        num_items: lines.reduce((sum, line) => sum + line.quantity, 0),
        currency: 'BRL',
        value: Number((valueCents / 100).toFixed(2))
    };
}
function trackAddToCart(line) {
    trackMeta('AddToCart', {
        ...productEventData([line]),
        content_name: orderProductName(line),
        content_category: line.category
    });
}
const storageKey = 'disk-panquecao-cart-v1';
let feedbackTimer;
function announceAdded(line) {
    byId('cartFeedbackText').textContent = '✓ ' + orderProductName(line) + ' adicionado';
    byId('cartFeedback').hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { byId('cartFeedback').hidden = true; }, 6000);
}
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
    // Links de categorias trazem o cliente diretamente para a ficha correta.
    // O timer evita a corrida quando a API carrega antes de registrar os listeners.
    if (!deepLinkOpened) window.setTimeout(openSharedProduct, 0);
}
function openSharedProduct() {
    if (deepLinkOpened || !catalog) return;
    const params = new URLSearchParams(window.location.search);
    const category = params.get('categoria');
    const product = params.get('produto');
    const option = params.get('opcao');
    if (!category || !product) return;
    if (!catalog.categorias.some(entry => entry.id === category &&
        entry.itens.some(item => item.nome === product))) return;
    const section = document.getElementById(category);
    if (!section) return;
    const card = [...section.querySelectorAll('.menu-item')].find(item =>
        item.dataset.product === product && (!option || item.dataset.option === option));
    const action = card?.querySelector('.product-details');
    const navigation = document.querySelector('.category-card[href="#' + category + '"]');
    if (!action || !navigation) return;
    deepLinkOpened = true;
    navigation.click();
    action.click();
}
document.addEventListener('menu-ready', event => initializeCatalog(event.detail));
if (window.menuCatalog) initializeCatalog(window.menuCatalog);

function refresh() {
    try { window.localStorage.setItem(storageKey, JSON.stringify({version: 1, updatedAt: Date.now(), lines: cart})); } catch {}
    if (!cart.length) checkoutStep = false;
    byId('checkout').hidden = !cart.length || !checkoutStep;
    byId('startCheckout').hidden = !cart.length || checkoutStep;
    byId('cartDialog').classList.toggle('checkout-mode', checkoutStep);
    byId('cartBack').textContent = checkoutStep ? '← Voltar ao carrinho' : '← Continuar escolhendo';
    byId('cartTitle').textContent = checkoutStep ? 'Contato e entrega' : 'Seu pedido';
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
        title.textContent = orderProductName(line);
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
            button.setAttribute('aria-label', label + ' quantidade de ' + orderProductName(line));
            button.disabled = sending || (delta < 0 ? line.quantity <= 1 : line.quantity >= 10);
            button.onclick = () => {
                line.quantity += delta;
                byId('whatsappOrderLink').hidden = true;
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
        remove.setAttribute('aria-label', 'Remover ' + orderProductName(line));
        remove.disabled = sending;
        remove.onclick = () => {
            cart.splice(index, 1);
            byId('whatsappOrderLink').hidden = true;
            refresh();
            (rows.children[Math.min(index, cart.length - 1)]?.querySelector('button') ||
                byId('cartDialog').querySelector('.cart-back')).focus({ preventScroll: true });
        };
        controls.append(stepper, remove);
        row.append(info, controls);
        rows.append(row);
    }
    const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);
    byId('openCart').textContent = '🛒 Pedido · ' + quantity + (quantity === 1 ? ' item' : ' itens') +
        (quantity ? ' · ' + money(total) : '');
    byId('cartCount').textContent = quantity ? quantity + (quantity === 1 ? ' item no pedido' : ' itens no pedido') : 'Vamos escolher algo gostoso?';
    byId('cartEmpty').hidden = !!cart.length;
    byId('cartSummary').hidden = !cart.length;
    byId('cartTotal').textContent = money(total);
    byId('sendOrder').disabled = !cart.length || sending || !storeOpenForOrders;
    byId('startCheckout').disabled = !cart.length || sending || !storeOpenForOrders;

}

document.addEventListener('store-operation-status', event => {
    const {enabled,open} = event.detail || {};
    storeOpenForOrders = !enabled || (open === true && event.detail.simulated !== true);
    if (!storeOpenForOrders) {
        const status = byId('orderStatus');
        if (status) status.textContent = event.detail.simulated ? 'Modo de demonstração: o envio de pedidos está desativado.' : 'Loja fechada ou temporariamente indisponível. Você pode consultar o cardápio, mas não enviar novos pré-pedidos.';
    }
    refresh();
});

// Itens com uma única opção, sem adicionais nem seleção de sabores:
 // adicionar com um toque. A foto e "Detalhes" continuam abrindo a ficha completa.
byId('menuContent').addEventListener('click', event => {
    const quick = event.target.closest('.quick-add');
    if (!quick || !catalog) return;
    const card = quick.closest('.menu-item');
    const category = card.closest('.category-section').id;
    const product = card.dataset.product;
    const item = catalog.categorias.find(entry => entry.id === category)?.itens.find(entry => entry.nome === product);
    if (!item || item.tamanhos || item.tamanhos_acai || category === 'panquecas-2-sabores') return;
    try {
        if (cart.length >= 25) throw new Error('O pedido atingiu o limite de itens.');
        const [line] = priceOrder(catalog, [{
            category, product, option: 'Único', quantity: 1,
            note: '', flavors: [], freeExtras: [], paidExtras: []
        }]);
        cart.push(line);
        trackAddToCart(line);
        byId('whatsappOrderLink').hidden = true;
        refresh();
        announceAdded(line);
    } catch (error) { byId('cartFeedbackText').textContent = error.message; byId('cartFeedback').hidden = false; }
});
byId('menuContent').addEventListener('click', event => {
    const button = event.target.closest('.product-details');
    if (!button || !catalog) return;
    const card = button.closest('.menu-item');
    const category = card.closest('.category-section').id;
    const product = card.dataset.product || card.querySelector('.item-title').textContent;
    const item = catalog.categorias.find(entry => entry.id === category)?.itens.find(entry => entry.nome === product);
    if (!item) return;
    const options = orderOptions(item).filter(option => !card.dataset.option || option.label === card.dataset.option);
    trackMeta('ViewContent', {
        content_type:'product', content_ids:[productId({category,product,option:card.dataset.option || 'Único'})],
        content_name:product, content_category:category,
        ...(options.length ? {currency:'BRL',value:options[0].cents/100} : {})
    });
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
        '<div class="quantity-picker"><span>Quantidade</span><div class="quantity-controls">' +
        '<button type="button" data-adjust="-1" aria-label="Diminuir quantidade">−</button>' +
        '<input aria-label="Quantidade do produto" name="quantity" type="number" inputmode="numeric" min="1" max="10" value="1" required>' +
        '<button type="button" data-adjust="1" aria-label="Aumentar quantidade">+</button>' +
        '</div></div>' +
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
    for (const control of form.querySelectorAll('[data-adjust]')) {
        control.onclick = () => {
            const input = form.elements.quantity;
            const next = Math.max(1, Math.min(10, (Number.parseInt(input.value, 10) || 1) +
                Number(control.dataset.adjust)));
            input.value = String(next);
            updateExtras();
        };
    }
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
        for (const button of form.querySelectorAll('[data-adjust]')) {
            button.disabled = Number(button.dataset.adjust) < 0 ? quantity <= 1 : quantity >= 10;
        }
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
            trackAddToCart(line);
        } catch (error) { formStatus.textContent = error.message; return; }
        byId('whatsappOrderLink').hidden = true;
        refresh();
        byId('productDialog').close();
        button.focus({ preventScroll: true });
        announceAdded({category, product});
    };
    byId('productDialogContent').append(form);
});


const checkoutForm = byId('checkout');
const orderStatus = byId('orderStatus');
const fallback = byId('whatsappOrderLink');
const cartDialog = byId('cartDialog');
const turnstileContainer = byId('orderTurnstile');
let widgetId;
let challengeWaiter;
let deliveryAreasData = null;
let deliveryAreasPromise = null;
let deliveryLocation = null;
const deliveryFields = byId('deliveryFields');
const tableFields = byId('tableFields');
const neighborhoodSelect = byId('deliveryNeighborhood');
const otherNeighborhood = byId('deliveryOtherNeighborhood');

function setDeliveryMode() {
    const mode = checkoutForm.elements.fulfillmentType.value;
    deliveryFields.hidden = mode !== 'delivery';
    tableFields.hidden = mode !== 'table';
    for (const field of deliveryFields.querySelectorAll('input,select')) {
        field.disabled = mode !== 'delivery' || (field === neighborhoodSelect && !checkoutForm.elements.deliveryCity.value) ||
            (field === otherNeighborhood && neighborhoodSelect.value !== '__other__');
    }
    checkoutForm.elements.tableIdentifier.disabled = mode !== 'table';
    checkoutForm.elements.tableIdentifier.required = mode === 'table';
    otherNeighborhood.required = mode === 'delivery' && neighborhoodSelect.value === '__other__';
    if (mode !== 'delivery') clearLocation();
}
checkoutForm.querySelectorAll('input[name="fulfillmentType"]').forEach(radio => {
    radio.addEventListener('change', () => {
        setDeliveryMode();
        fallback.hidden = true;
        orderStatus.textContent = '';
    });
});
function clearLocation() {
    deliveryLocation = null;
    byId('deliveryLocationStatus').textContent = '';
    byId('deliveryLocationPreview').hidden = true;
    byId('deliveryLocationPreview').removeAttribute('href');
    byId('removeDeliveryLocation').hidden = true;
}
byId('removeDeliveryLocation').addEventListener('click', () => {
    clearLocation();
    orderStatus.textContent = '';
    fallback.hidden = true;
});
byId('captureDeliveryLocation').addEventListener('click', () => {
    if (checkoutForm.elements.fulfillmentType.value !== 'delivery') return;
    if (!navigator.geolocation?.getCurrentPosition) {
        byId('deliveryLocationStatus').textContent =
            'Seu navegador não oferece localização. Você pode continuar informando o endereço.';
        return;
    }
    byId('deliveryLocationStatus').textContent = 'Solicitando autorização para acessar o GPS…';
    byId('captureDeliveryLocation').disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
        byId('captureDeliveryLocation').disabled = false;
        if (checkoutForm.elements.fulfillmentType.value !== 'delivery') return;
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            byId('deliveryLocationStatus').textContent = 'Não foi possível validar sua localização.';
            return;
        }
        deliveryLocation = {latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6))};
        const accuracy = Number(position.coords.accuracy);
        byId('deliveryLocationStatus').textContent = '✓ Ponto registrado' +
            (Number.isFinite(accuracy) ? ' (precisão aproximada: ' + Math.round(accuracy) + ' m).' : '.') +
            ' Confira o ponto no mapa. O endereço escrito continua obrigatório.';
        const preview = byId('deliveryLocationPreview');
        preview.href = 'https://www.google.com/maps?q=' + deliveryLocation.latitude + ',' + deliveryLocation.longitude;
        preview.hidden = false;
        byId('removeDeliveryLocation').hidden = false;
        orderStatus.textContent = '';
        fallback.hidden = true;
    }, error => {
        byId('captureDeliveryLocation').disabled = false;
        byId('deliveryLocationStatus').textContent = error.code === 1
            ? 'Localização não autorizada. Tudo bem: preencha o endereço normalmente.'
            : 'GPS indisponível agora. Você pode continuar informando o endereço.';
    }, {enableHighAccuracy: false, timeout: 12000, maximumAge: 0});
});
async function loadDeliveryAreas() {
    if (deliveryAreasData) return deliveryAreasData;
    if (!deliveryAreasPromise) {
        deliveryAreasPromise = fetch('/delivery-areas.json', {cache: 'no-cache'})
            .then(response => {
                if (!response.ok) throw new Error('Lista de bairros indisponível');
                return response.json();
            })
            .then(data => {
                if (!Array.isArray(data?.cities?.['Nova Hartz']) ||
                    !Array.isArray(data?.cities?.['Araricá'])) throw new Error('Bairros inválidos');
                deliveryAreasData = data;
                return data;
            }).catch(() => { deliveryAreasPromise = null; return null; });
    }
    return deliveryAreasPromise;
}
function updateOtherNeighborhood() {
    const show = neighborhoodSelect.value === '__other__';
    byId('deliveryOtherWrap').hidden = !show;
    otherNeighborhood.disabled = !show || checkoutForm.elements.fulfillmentType.value !== 'delivery';
    otherNeighborhood.required = show && !otherNeighborhood.disabled;
}
checkoutForm.elements.deliveryNeighborhood.addEventListener('change', updateOtherNeighborhood);
async function populateDeliveryNeighborhoods() {
    const city = checkoutForm.elements.deliveryCity.value;
    neighborhoodSelect.replaceChildren(new Option('Carregando bairros…', ''));
    neighborhoodSelect.value = '';
    neighborhoodSelect.disabled = true;
    updateOtherNeighborhood();
    if (!city) {
        neighborhoodSelect.replaceChildren(new Option('Selecione primeiro a cidade', ''));
        return;
    }
    const data = await loadDeliveryAreas();
    if (checkoutForm.elements.deliveryCity.value !== city) return;
    neighborhoodSelect.replaceChildren(new Option('Selecione seu bairro', ''));
    for (const area of data?.cities?.[city] || []) {
        neighborhoodSelect.add(new Option(area.name, area.name));
    }
    neighborhoodSelect.add(new Option('Outro bairro / localidade', '__other__'));
    neighborhoodSelect.disabled = checkoutForm.elements.fulfillmentType.value !== 'delivery';
    updateOtherNeighborhood();
}
checkoutForm.elements.deliveryCity.addEventListener('change', populateDeliveryNeighborhoods);
setDeliveryMode();

let accountFeatureEnabled=false;
let savedAddresses=[],savedNext=null,savedLoading=false,activeAccount=null,accountEpoch=0,accountCheck=null,profileEdited=false,localLogout=false;
const savedStatus=byId('savedAccountStatus'),savedSelect=byId('savedAddressSelect');
const accountNav=byId('customerAccountNav'),accountJoin=byId('accountJoinLink'),accountLogout=byId('checkoutAccountLogout'),accountReload=byId('loadSavedAccount');
function savedMessage(msg){if(savedStatus)savedStatus.textContent=msg;}
function showAccountState(){
 const connected=!!activeAccount;
 if(accountNav)accountNav.textContent=connected?'Minha conta · conectada':'Minha conta';
 if(accountJoin)accountJoin.textContent=connected?'Gerenciar minha conta ↗':'Entrar ou criar conta →';
 if(accountLogout)accountLogout.hidden=!connected;
 if(accountReload)accountReload.hidden=!connected;
 if(byId('savedAccountHeading'))byId('savedAccountHeading').textContent=connected?'Você já é de casa!':'Seja de casa!';
 if(byId('savedAccountPitch'))byId('savedAccountPitch').textContent=connected?'Sua conta está conectada. Escolha onde receber. PanqueCoins em breve.':'Crie sua conta, salve seus endereços e prepare-se para acumular PanqueCoins quando o programa for liberado. Você também pode pedir sem cadastro.';
 const loyalty=byId('loyaltyAccountLink');if(loyalty)loyalty.textContent=connected?'Minha conta →':'Quero fazer parte →';
}
function displaySavedAddresses(){
 if(!savedSelect)return;
 const current=savedSelect.value;
 savedSelect.replaceChildren(new Option('Escolha um endereço',''));
 for(const a of savedAddresses)savedSelect.add(new Option(a.label+' · '+a.data.city,a.id));
 if(savedAddresses.some(a=>a.id===current))savedSelect.value=current;
 byId('savedAddresses').hidden=!activeAccount||!savedAddresses.length;
 byId('moreSavedAddresses').hidden=!savedNext;
}
function clearAccountFields(){
 accountEpoch++;activeAccount=null;profileEdited=false;savedAddresses=[];savedNext=null;
 for(const field of ['customerName','customerPhone','deliveryCity','deliveryNeighborhood','deliveryOtherNeighborhood','deliveryStreet','deliveryNumber','deliveryComplement','deliveryReference'])checkoutForm.elements[field].value='';
 neighborhoodSelect.replaceChildren(new Option('Selecione primeiro a cidade',''));neighborhoodSelect.disabled=true;
 clearLocation();updateOtherNeighborhood();displaySavedAddresses();showAccountState();
 checkoutForm.dispatchEvent(new window.Event('input',{bubbles:true}));
}
async function fetchSavedAddresses(more=false){
 const epoch=accountEpoch,account=activeAccount;
 const result=await accountRequest('addresses',null,more&&savedNext?{after:savedNext}:{});
 if(epoch!==accountEpoch||activeAccount!==account)return;
 savedAddresses=more?[...savedAddresses,...result.addresses]:result.addresses;savedNext=result.next;
 displaySavedAddresses();
}
function applyAccountProfile(force=false){
 if(!activeAccount||(!force&&profileEdited))return;
 const e=checkoutForm.elements,p=activeAccount.profile||{};
 if(force||!e.customerName.value)e.customerName.value=p.name||'';
 if(force||!e.customerPhone.value)e.customerPhone.value=p.phone||'';
 checkoutForm.dispatchEvent(new window.Event('input',{bubbles:true}));
}
async function detectAccount({checkout=false,force=false}={}){
 if(localLogout||!accountFeatureEnabled)return;
 if(accountCheck)await accountCheck;
 if(localLogout||!accountFeatureEnabled)return;
 const epoch=accountEpoch;
 const pending=(async()=>{
  try{
   const state=await accountRequest('state');
   if(epoch!==accountEpoch||localLogout)return;
   if(activeAccount&&activeAccount.email!==state.email)clearAccountFields();
   const first=!activeAccount;
   activeAccount=state;showAccountState();
   if(checkout){
    applyAccountProfile(force||first&&!profileEdited);
    await fetchSavedAddresses();
    if(activeAccount===state)savedMessage(savedAddresses.length?'Conta reconhecida. Escolha onde receber seu pedido.':'Conta reconhecida. Você pode informar ou cadastrar um endereço.');
   }
  }catch(err){
   if(epoch!==accountEpoch||localLogout)return;
   if(activeAccount)clearAccountFields();
   if(checkout)savedMessage(err.status===401?'Crie sua conta ou continue sem cadastro.':'Não foi possível confirmar a sessão. Você pode pedir sem cadastro.');
  }
 })();
 accountCheck=pending;
 try{await pending;}finally{if(accountCheck===pending)accountCheck=null;}
}
if(accountReload)accountReload.onclick=()=>detectAccount({checkout:true,force:true});
if(accountLogout)accountLogout.onclick=async()=>{
 if(savedLoading||sending)return;
 savedLoading=true;localLogout=true;accountLogout.disabled=true;clearAccountFields();
 try{await accountRequest('logout',{});try{window.localStorage.setItem('dp-account-session-change-v1','logout:'+Date.now());}catch{}savedMessage('Você saiu da conta. Seu carrinho foi preservado.');}
 catch{savedMessage('Não foi possível confirmar a saída no servidor. Abra Minha conta para sair com segurança.');}
 finally{savedLoading=false;accountLogout.disabled=false;}
};
if(byId('moreSavedAddresses'))byId('moreSavedAddresses').onclick=async()=>{
 if(savedLoading||!activeAccount)return;savedLoading=true;try{await fetchSavedAddresses(true);}catch{savedMessage('Não foi possível carregar mais endereços.');}finally{savedLoading=false;}
};
if(savedSelect)savedSelect.onchange=async()=>{
 if(savedLoading||!activeAccount)return;const found=savedAddresses.find(x=>x.id===savedSelect.value);if(!found)return;
 savedLoading=true;savedSelect.disabled=true;const epoch=accountEpoch;
 try{
  const d=found.data,e=checkoutForm.elements;
  e.fulfillmentType.value='delivery';setDeliveryMode();clearLocation();
  e.deliveryCity.value=d.city;await populateDeliveryNeighborhoods();
  if(epoch!==accountEpoch||e.deliveryCity.value!==d.city||e.fulfillmentType.value!=='delivery')return;
  const known=[...e.deliveryNeighborhood.options].some(x=>x.value===d.neighborhood);
  e.deliveryNeighborhood.value=known?d.neighborhood:'__other__';e.deliveryOtherNeighborhood.value=d.neighborhood==='__other__'?d.otherNeighborhood||'':known?'':d.neighborhood;
  for(const [field,key] of [['deliveryStreet','street'],['deliveryNumber','number'],['deliveryComplement','complement'],['deliveryReference','reference']])e[field].value=d[key]||'';
  updateOtherNeighborhood();checkoutForm.dispatchEvent(new window.Event('input',{bubbles:true}));
  savedMessage('Endereço selecionado. Confira os dados e a taxa antes de enviar.');
 }catch{savedMessage('Não foi possível carregar esse endereço. Preencha manualmente.');}finally{savedLoading=false;savedSelect.disabled=false;}
};
checkoutForm.addEventListener('input',e=>{if(e.isTrusted&&['customerName','customerPhone'].includes(e.target.name))profileEdited=true;});
window.addEventListener('pageshow',e=>{if(e.persisted)void detectAccount({checkout:checkoutStep});});
window.addEventListener('storage',e=>{if(e.key==='dp-account-session-change-v1'&&document.body.dataset.premiumPreview!=='true'){if(activeAccount)clearAccountFields();localLogout=String(e.newValue||'').startsWith('logout:');if(!localLogout)void detectAccount({checkout:checkoutStep});}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&activeAccount&&accountFeatureEnabled)void detectAccount({checkout:checkoutStep});});


function getFulfillment() {
    const e = checkoutForm.elements;
    const type = e.fulfillmentType.value;
    return normalizeFulfillment({
        type, city: e.deliveryCity.value, neighborhood: e.deliveryNeighborhood.value,
        otherNeighborhood: e.deliveryOtherNeighborhood.value,
        street: e.deliveryStreet.value, number: e.deliveryNumber.value,
        complement: e.deliveryComplement.value, reference: e.deliveryReference.value,
        table: e.tableIdentifier.value,
        latitude: type === 'delivery' ? deliveryLocation?.latitude : undefined,
        longitude: type === 'delivery' ? deliveryLocation?.longitude : undefined
    }, deliveryAreasData || {cities:{'Nova Hartz':[], 'Araricá':[]}});
}

function openCart() {
    checkoutStep = false;
    refresh();
    if (!cartDialog.open) cartDialog.showModal();
}
byId('openCart').onclick = openCart;
byId('cartFeedbackCart').onclick = () => {
    byId('cartFeedback').hidden = true;
    clearTimeout(feedbackTimer);
    openCart();
};
byId('cartBack').onclick = () => {
    if (checkoutStep) {
        checkoutStep = false;
        refresh();
        byId('startCheckout').focus({preventScroll:true});
    } else cartDialog.close();
};
byId('startCheckout').onclick = () => {
    if (!cart.length || !storeOpenForOrders) return;
    checkoutStep = true;
    if (!checkoutEventSent) {
        checkoutEventSent = trackMeta('InitiateCheckout', productEventData(cart));
    }
    refresh();
    checkoutForm.elements.customerName.focus({preventScroll:true});
    void detectAccount({checkout:true});
};
checkoutForm.addEventListener('input', () => {
    fallback.hidden = true;
    orderStatus.textContent = '';
});

function requestId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function validateCustomer() {
    const name = checkoutForm.elements.customerName.value.trim();
    let phone = checkoutForm.elements.customerPhone.value.replace(/\D/g, '');
    if (phone.startsWith('55') && [12,13].includes(phone.length)) phone = phone.slice(2);
    if (!name || name.length > 80) throw new Error('Informe seu nome para o registro.');
    if (!/^(?:[1-9]\d)(?:9\d{8}|\d{8})$/.test(phone)) {
        throw new Error('Informe um WhatsApp válido com DDD para a loja poder chamar você.');
    }
    return {name, phone};
}
async function ensureTurnstile() {
    if (widgetId !== undefined) return;
    const response = await fetch('/api/order-config', {cache: 'no-store'});
    if (!response.ok) throw new Error('Não conseguimos iniciar o registro seguro de pedidos.');
    const config = await response.json();
    if (!config.siteKey) throw new Error('O registro pelo bot está indisponível neste momento.');
    if (!window.turnstile) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Não conseguimos carregar a verificação de segurança.'));
            document.head.append(script);
        });
    }
    if (!window.turnstile?.render || !window.turnstile?.execute) {
        throw new Error('Verificação de segurança não suportada neste navegador.');
    }
    widgetId = window.turnstile.render(turnstileContainer, {
        sitekey: config.siteKey,
        action: 'order_intent',
        execution: 'execute',
        appearance: 'interaction-only',
        theme: 'light',
        callback(token) {
            const pending = challengeWaiter;
            challengeWaiter = null;
            pending?.resolve(token);
        },
        'error-callback'() {
            const pending = challengeWaiter;
            challengeWaiter = null;
            pending?.reject(new Error('Falha na verificação de segurança.'));
        },
        'expired-callback'() {
            const pending = challengeWaiter;
            challengeWaiter = null;
            pending?.reject(new Error('Verificação expirada; tente novamente.'));
        }
    });
}
async function getChallenge() {
    await ensureTurnstile();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!challengeWaiter) return;
            challengeWaiter = null;
            reject(new Error('A verificação demorou demais. Tente novamente.'));
        }, 30000);
        challengeWaiter = {
            resolve: token => { clearTimeout(timeout); resolve(token); },
            reject: error => { clearTimeout(timeout); reject(error); }
        };
        try { window.turnstile.reset(widgetId); window.turnstile.execute(widgetId); }
        catch (error) {
            clearTimeout(timeout); challengeWaiter = null;
            reject(new Error('Não foi possível iniciar a verificação.'));
        }
    });
}
function openWhatsApp(url) {
    fallback.href = url;
    fallback.hidden = false;
    window.location.assign(url);
}

checkoutForm.onsubmit = async event => {
    event.preventDefault();
    if(accountFeatureEnabled&&(accountCheck||savedLoading)){savedMessage('Aguarde a conferência da conta e do endereço.');return;}
    if (sending) return;
    if (!storeOpenForOrders) {
        orderStatus.textContent = 'A loja está fechada. Tente novamente no próximo expediente.';
        return;
    }
    if (!cart.length || !catalog) {
        orderStatus.textContent = 'Escolha seus itens antes de continuar.';
        return;
    }
    let lines, customer, note, signature, fulfillment;
    try {
        customer = validateCustomer();
        fulfillment = getFulfillment();
        lines = priceOrder(catalog, cart);
        note = checkoutForm.elements.orderNote.value.trim();
        signature = JSON.stringify({lines, customer, note, fulfillment});
    } catch (error) {
        orderStatus.textContent = error?.message || 'Confira o pedido e seu contato.';
        return;
    }
    const directMessage = buildSimpleWhatsAppMessage({
        lines, note, name: customer.name, fulfillment
    });
    const directUrl = whatsappOrderUrl(directMessage);
    fallback.hidden = true;
    sending = true;
    refresh();
    orderStatus.textContent = 'Registrando o pré-pedido e enviando o cupom térmico ao bot…';
    try {
        let registration;
        if (lastRegistration?.signature === signature) {
            registration = lastRegistration;
        } else {
            const challenge = await getChallenge();
            const response = await fetch('/api/whatsapp-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: requestId(), name: customer.name, phone: customer.phone,
                    lines, note,
                    fulfillment: fulfillment.type === 'delivery'
                        ? {...fulfillment, latitude: fulfillment.location?.latitude,
                            longitude: fulfillment.location?.longitude}
                        : fulfillment,
                    challenge
                }),
                signal: AbortSignal.timeout(50000)
            });
            const data = await response.json();
            if (!response.ok || data.status !== 'registered' || data.pending) {
                throw new Error(data.error || 'O registro no bot não pôde ser confirmado.');
            }
            registration = {id: data.id, test: data.test, signature};
            lastRegistration = registration;
        }
        if (registration.test) {
            orderStatus.textContent = 'TESTE: pré-registro enviado ao bot de homologação. Nenhum WhatsApp foi aberto.';
            return;
        }
        // Não marcar Purchase: o registro no bot não confirma envio no WhatsApp
        // nem aceite/pagamento da loja. Lead identifica SOMENTE o pré-registro.
        if (!trackedPreOrders.has(registration.id)) {
            const counted = trackMeta('Lead', {
                content_category:'pre_pedido_registrado',
                content_type:'product',
                content_ids:lines.map(productId),
                num_items:lines.reduce((sum,line)=>sum+line.quantity,0),
                currency:'BRL',
                value:0,
                status:'pending_whatsapp_confirmation'
            });
            if (counted) trackedPreOrders.add(registration.id);
        }
        const message = buildSimpleWhatsAppMessage({
            lines, note, name: customer.name, fulfillment, orderRef: registration.id
        });
        orderStatus.textContent = 'Pré-registro #' + registration.id +
            ' e cupom térmico enviados ao bot. Abrindo WhatsApp: confira e toque em Enviar.';
        openWhatsApp(whatsappOrderUrl(message));
    } catch (error) {
        orderStatus.textContent = (error?.message || 'Não foi possível registrar no bot.') +
            ' Você ainda pode contatar a loja; esse caminho não gera alerta no bot.';
        fallback.href = directUrl;
        fallback.textContent = 'Continuar pelo WhatsApp sem registro no bot';
        fallback.hidden = false;
    } finally {
        sending = false;
        refresh();
    }
};

if(accountNav)void (async()=>{try{const cfg=await accountRequest('config');if(cfg.enabled!==true)return;accountFeatureEnabled=true;accountNav.hidden=false;document.querySelector('.checkout-account').hidden=false;const link=byId('loyaltyAccountLink');if(link)link.hidden=false;await detectAccount({checkout:checkoutStep});}catch{/* Existing guest checkout remains available. */}})();
