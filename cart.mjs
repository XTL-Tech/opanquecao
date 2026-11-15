import { money, orderOptions, priceOrder } from './order-catalog.mjs';

const byId = id => document.getElementById(id);
const cart = [];
let catalog;
let widget;
let challenge;
let sending = false;
let digitalAvailable = false;

document.addEventListener('menu-ready', event => { catalog = event.detail; });

function refresh() {
    byId('checkout').hidden = !digitalAvailable || !cart.length;
    const rows = byId('cartLines');
    rows.replaceChildren();
    let total = 0;
    for (const [index, line] of cart.entries()) {
        total += line.cents * line.quantity;
        const row = document.createElement('div');
        row.className = 'cart-line';
        row.textContent = `${line.quantity} × ${line.product} (${line.option}) · ${money(line.cents * line.quantity)} `;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remover';
        remove.setAttribute('aria-label', 'Remover ' + line.product);
        remove.disabled = sending;
        remove.onclick = () => { cart.splice(index, 1); refresh(); };
        row.append(remove);
        rows.append(row);
    }
    byId('openCart').textContent = cart.length ? 'Fazer pedido (' + cart.reduce((sum, line) => sum + line.quantity, 0) + ')' : 'Fazer pedido';
    byId('cartTotal').textContent = cart.length ? 'Subtotal: ' + money(total) : 'Seu carrinho está vazio.';
    byId('sendOrder').disabled = !cart.length || !challenge || sending;
    const fallback = byId('cartWhatsApp');
    fallback.hidden = !cart.length || sending;
    const summary = cart.map(line => `${line.quantity} × ${line.product} (${line.option})${line.note ? ' — ' + line.note : ''}`);
    fallback.href = 'https://wa.me/5551997383849?text=' +
        encodeURIComponent(['Olá! Quero pedir:', ...summary].join('\n'));
}

byId('menuContent').addEventListener('click', event => {
    const button = event.target.closest('.product-details');
    if (!button || !catalog) return;
    const card = button.closest('.menu-item');
    const category = card.closest('.category-section').id;
    const product = card.querySelector('.item-title').textContent;
    const item = catalog.categorias.find(entry => entry.id === category)?.itens.find(entry => entry.nome === product);
    if (!item) return;
    const options = orderOptions(item);
    if (!options.length) return;
    const form = document.createElement('form');
    form.className = 'order-form';
    form.innerHTML = '<label>Opção <select name="option" required></select></label>' +
        '<label>Quantidade <input name="quantity" type="number" min="1" max="10" value="1" required></label>' +
        '<label>Observações <textarea name="note" maxlength="160"></textarea></label>' +
        '<button>Adicionar ao carrinho</button><p role="status"></p>';
    for (const option of options) form.elements.option.add(new Option(option.label + ' · ' + money(option.cents), option.label));
    form.onsubmit = event => {
        event.preventDefault();
        const selected = options.find(option => option.label === form.elements.option.value);
        if (!selected || cart.length >= 25) {
            form.querySelector('[role=status]').textContent = 'O carrinho atingiu o limite de itens.';
            return;
        }
        cart.push({ category, product, option: selected.label, cents: selected.cents,
            quantity: form.elements.quantity.valueAsNumber, note: form.elements.note.value.trim() });
        refresh();
        byId('productDialog').close();
        byId('openCart').focus({ preventScroll: true });
    };
    byId('productDialogContent').append(form);
});

let configPromise;
byId('openCart').onclick = async () => {
    if (!cart.length) {
        const firstProduct = document.querySelector('.product-details');
        if (firstProduct) {
            firstProduct.focus({ preventScroll: true });
            firstProduct.scrollIntoView({ block: 'center' });
        }
        return;
    }
    refresh();
    byId('cartDialog').showModal();
    if (widget !== undefined) return;
    try {
        configPromise ??= fetch('/api/order-config').then(response => response.json());
        const { siteKey } = await configPromise;
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
        byId('orderStatus').textContent = 'Envio digital indisponível. Você pode continuar pelo WhatsApp.';
    } finally {
        byId('checkout').hidden = !digitalAvailable;
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
        const response = await fetch('/api/order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines, name: form.elements.name.value,
                phone: form.elements.phone.value.replace(/\D/g, ''), challenge })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        cart.length = 0;
        form.reset();
        status.textContent = 'Solicitação #' + result.id + ' enviada. Aguarde a confirmação da loja.';
    } catch (error) {
        status.textContent = 'Confira antes de reenviar. ' + error.message;
    } finally {
        sending = false;
        challenge = undefined;
        window.turnstile.reset(widget);
        refresh();
    }
};
