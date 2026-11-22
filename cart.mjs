import { money, orderOptions, priceOrder, extraOptions, extraSummary, flavorChoices, orderProductName } from './order-catalog.mjs';
import { buildSimpleWhatsAppMessage, whatsappOrderUrl } from './whatsapp-order.mjs';

const byId = id => document.getElementById(id);
const cart = [];
let catalog;
let sending = false;
const initialStoreStatus = window.storeOperationStatus;
let storeOpenForOrders = !initialStoreStatus?.enabled ||
    (initialStoreStatus.open === true && initialStoreStatus.simulated !== true);

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
    // Pedidos do carrinho abrem diretamente no WhatsApp, sem backend de pedidos.
    byId('checkout').hidden = !cart.length;
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
    byId('openCart').textContent = 'Ver pedido · ' + quantity + (quantity === 1 ? ' item' : ' itens');
    byId('cartCount').textContent = quantity ? quantity + (quantity === 1 ? ' item no pedido' : ' itens no pedido') : 'Vamos escolher algo gostoso?';
    byId('cartEmpty').hidden = !!cart.length;
    byId('cartSummary').hidden = !cart.length;
    byId('cartTotal').textContent = money(total);
    byId('sendOrder').disabled = !cart.length || sending || !storeOpenForOrders;

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
        byId('whatsappOrderLink').hidden = true;
        refresh();
        byId('productDialog').close();
        button.focus({ preventScroll: true });
        byId('cartFeedback').textContent = '✓ ' + orderProductName({category, product}) + ' adicionado ao pedido';
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => { byId('cartFeedback').textContent = ''; }, 3500);
    };
    byId('productDialogContent').append(form);
});

const checkoutForm = byId('checkout');
const orderStatus = byId('orderStatus');
const fallback = byId('whatsappOrderLink');

// O cliente precisa apenas escolher produtos. Não há validação de cadastro,
// pagamento, endereço, Telegram, API de pedido nem desafio Turnstile.
byId('openCart').onclick = () => {
    refresh();
    byId('cartDialog').showModal();
};
checkoutForm.addEventListener('input', () => {
    fallback.hidden = true;
    orderStatus.textContent = '';
});
checkoutForm.onsubmit = event => {
    event.preventDefault();
    if (sending) return;
    if (!storeOpenForOrders) {
        orderStatus.textContent = 'Loja fechada no momento. Confira o horário antes de pedir.';
        return;
    }
    if (!cart.length || !catalog) {
        orderStatus.textContent = 'Escolha seus itens antes de continuar.';
        return;
    }
    sending = true;
    refresh();
    try {
        // Revalidar sabores, complementos e preços com o catálogo vigente.
        const lines = priceOrder(catalog, cart);
        const message = buildSimpleWhatsAppMessage({
            lines,
            note: checkoutForm.elements.orderNote.value
        });
        const url = whatsappOrderUrl(message);
        fallback.href = url;
        fallback.hidden = false;
        orderStatus.textContent = 'Abrindo o WhatsApp. Confira e toque em Enviar. A loja ainda não recebeu o pedido.';
        // Mesma aba evita bloqueio de pop-ups em dispositivos móveis.
        window.location.assign(url);
    } catch (error) {
        orderStatus.textContent = (error?.message || 'Não foi possível preparar o pedido.') +
            ' Nenhum pedido foi enviado; confira o carrinho e tente novamente.';
    } finally {
        sending = false;
        refresh();
    }
};
