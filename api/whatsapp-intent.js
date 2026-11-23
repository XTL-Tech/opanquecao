'use strict';

const { orderPdf } = require('../lib/order-pdf');
const backoffice=require('../lib/backoffice-neon');
const { loadCatalog } = require('../lib/catalog-source');
const { loadStoreStatus } = require('../lib/store-hours-source');
const deliveryAreas = require('../delivery-areas.json');

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max = 160) => String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const normalizePhone = value => {
    let phone = String(value ?? '').replace(/\D/g, '');
    if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
    return /^(?:[1-9]\d)(?:9\d{8}|\d{8})$/.test(phone) ? phone : null;
};

function messageParts({ id, name, phone, lines, note, fulfillment, describeFulfillment, money, extraSummary, orderProductName }) {
    const subtotal = lines.reduce((total, line) => total + line.cents * line.quantity, 0);
    const parts = [
        '🧾 PRÉ-REGISTRO DO SITE — DISK PANQUECÃO',
        'Código: #' + id,
        '⚠️ NÃO É PEDIDO CONFIRMADO. Cliente ainda precisa enviar a mensagem no WhatsApp.',
        '',
        'Cliente: ' + clean(name, 80),
        'WhatsApp: +55' + phone,
        'Origem: cardápio online → WhatsApp',
        '',
        'RECEBIMENTO',
        ...describeFulfillment(fulfillment),
        '',
        'ITENS'
    ];
    for (const [index, line] of lines.entries()) {
        parts.push((index + 1) + '. ' + line.quantity + 'x ' + clean(orderProductName(line), 155) +
            (line.option === 'Único' ? '' : ' | ' + clean(line.option, 30)) +
            ' | ' + money(line.cents * line.quantity));
        if (line.flavors?.length) parts.push('   Sabores: ' + line.flavors.map(flavor => clean(flavor, 75)).join(' / '));
        for (const description of extraSummary(line)) parts.push('   ' + clean(description, 210));
        if (line.note) parts.push('   Obs.: ' + clean(line.note, 160));
    }
    if (note) parts.push('', 'Observação geral: ' + clean(note, 400));
    parts.push('', 'Subtotal sem entrega: ' + money(subtotal),
        fulfillment.type === 'delivery'
            ? 'Frete e valor final: A CONFIRMAR PELA LOJA NO WHATSAPP.'
            : 'Forma de pagamento: a combinar.',
        'Aguardar confirmação expressa no WhatsApp antes de preparar.');
    return parts.join('\n');
}

function splitTelegram(text, max = 3900) {
    if (text.length <= max) return [text];
    const lines = text.split('\n');
    const chunks = [];
    let chunk = '';
    for (const line of lines) {
        if (line.length > max) throw new Error('Linha longa demais para Telegram');
        if (chunk.length + line.length + 1 > max) {
            chunks.push(chunk);
            chunk = '';
        }
        chunk += (chunk ? '\n' : '') + line;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
}

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido.' });

    const config = {
        token: process.env.TELEGRAM_BOT_TOKEN,
        chat: process.env.TELEGRAM_CHAT_ID,
        secret: process.env.TURNSTILE_SECRET_KEY
    };
    if (!config.token || !config.chat || !config.secret) {
        return res.status(503).json({ error: 'Registro de pré-pedido indisponível. Continue pelo WhatsApp.' });
    }
    const raw = req.body || {};
    if (typeof raw !== 'object' || Array.isArray(raw) ||
        JSON.stringify(raw).length > 16000) {
        return res.status(400).json({ error: 'Pedido inválido ou muito grande.' });
    }
    const { requestId, name, phone, challenge, lines, note, fulfillment } = raw;
    const normalizedPhone = normalizePhone(phone);
    if (!REQUEST_ID.test(requestId) || typeof name !== 'string' || !clean(name, 80) ||
        name.length > 80 || /[\r\n]/.test(name) || !normalizedPhone ||
        typeof note !== 'string' || note.length > 400 ||
        typeof challenge !== 'string' || challenge.length < 1 || challenge.length > 2048) {
        return res.status(400).json({ error: 'Confira nome, WhatsApp e dados do pré-pedido.' });
    }
    let deliveryDetails, describeFulfillment;
    try {
        const functions = await import('../fulfillment.mjs');
        describeFulfillment = functions.describeFulfillment;
        deliveryDetails = functions.normalizeFulfillment(fulfillment, deliveryAreas);
    } catch (error) {
        return res.status(400).json({ error: error?.message || 'Confira o endereço e a modalidade do pedido.' });
    }
    // Fail closed: nunca informar a equipe de que um pedido é válido sem
    // conferir catálogo e horário no servidor.
    try {
        const status = await loadStoreStatus();
        if (status.enabled && !status.open) {
            return res.status(423).json({ error: 'A loja está fechada para novos pedidos.' });
        }
    } catch {
        return res.status(503).json({ error: 'Não foi possível verificar o horário da loja.' });
    }
    let validated;
    let money, extraSummary, orderProductName;
    try {
        const catalog = await loadCatalog();
        ({ money, extraSummary, orderProductName } = await import('../order-catalog.mjs'));
        const { priceOrder } = await import('../order-catalog.mjs');
        validated = priceOrder(catalog, lines);
    } catch {
        return res.status(400).json({ error: 'Um produto ou preço mudou. Atualize o cardápio antes de continuar.' });
    }

    // Cloudflare Turnstile é obrigatório: impede que uma API pública
    // seja usada para bombardear o Telegram com alertas falsos.
    let checked;
    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: new URLSearchParams({ secret: config.secret, response: challenge }),
            signal: AbortSignal.timeout(6500)
        });
        if (!response.ok) throw new Error('Verificação indisponível');
        checked = await response.json();
    } catch {
        return res.status(503).json({ error: 'Verificação indisponível. Tente novamente ou abra o WhatsApp diretamente.' });
    }
    const host = String(req.headers?.host || '').split(':')[0].toLowerCase();
    if (!checked.success || (checked.action && checked.action !== 'order_intent') ||
        (checked.hostname && (!host || checked.hostname.toLowerCase() !== host))) {
        return res.status(403).json({ error: 'Não foi possível verificar esta tentativa. Tente novamente.' });
    }

    const id = requestId.slice(0, 8).toUpperCase();
    const preview = process.env.VERCEL_ENV !== 'production';
    const operatorText = messageParts({
        id, name, phone: normalizedPhone, lines: validated, note,
        fulfillment: deliveryDetails, describeFulfillment,
        money, extraSummary, orderProductName
    });
    const whatsAppLink = 'https://wa.me/55' + normalizedPhone +
        '?text=' + encodeURIComponent('Olá, ' + clean(name, 60) + '! Aqui é o Disk Panquecão. ' +
            'Vimos seu pré-pedido #' + id + ' no nosso cardápio. ' +
            'Você chegou a enviar a mensagem com o pedido no WhatsApp? Podemos confirmar os detalhes por aqui?');
    // O fluxo ativo usa /api/whatsapp-intent; o PDF 58 mm já existia
    // no checkout legado. Reaproveitamos o gerador com preços validados
    // NO SERVIDOR e frete SEMPRE a confirmar (nunca inventar taxa).
    // Gerar antes de alertar a loja evita uma mensagem sem cupom caso
    // haja falha de renderização.
    const subtotal = validated.reduce((total, line) => total + line.cents * line.quantity, 0);
    let receipt;
    try {
        receipt = await orderPdf({
            id, name: clean(name, 80), phone: '+55' + normalizedPhone,
            items: validated, subtotal, money,
            fulfillment: { ...deliveryDetails, feeCents: null },
            payment: { method: 'pending', label: 'A confirmar', changeForCents: null },
            testMode: preview, awaitingWhatsApp: true
        });
    } catch {
        console.warn(JSON.stringify({event:'whatsapp_intent',id,status:'pdf_error',preview}));
        return res.status(503).json({
            error:'Não foi possível gerar o cupom para a loja. Tente novamente ou contate o estabelecimento.'
        });
    }
    // Backoffice: persistir e reivindicar referência ANTES de emitir o alerta.
    // Em produção, se habilitado, banco indisponível => fail-closed, sem
    // notificações soltas e sem dois pedidos com o mesmo requestId.
    // Preview NÃO cria cliente/pedido real, mesmo com variáveis configuradas.
    let persisted = false;
    if (backoffice.configured() && !preview) {
        try {
            const customer=await backoffice.upsertCustomer({name:clean(name,80),phone:normalizedPhone});
            const claimed=await backoffice.createOrder({
                requestId,customer,items:validated,fulfillment:deliveryDetails,
                note:clean(note,400),origin:'site',status:'pending_customer',telegramState:'pending'
            });
            if (!claimed.created) {
                return claimed.record.telegram_state==='sent'
                    ? res.status(201).json({id,status:'registered',test:false,replayed:true})
                    : res.status(202).json({id,pending:true,
                        error:'Este pré-pedido já existe, mas o envio ao Telegram requer conferência. Não reenvie automaticamente.'});
            }
            persisted=true;
        } catch {
            console.warn(JSON.stringify({event:'whatsapp_intent',id,status:'database_unavailable'}));
            return res.status(503).json({
                error:'Não foi possível registrar o pedido com segurança. Fale com a loja no WhatsApp.'
            });
        }
    }
    const parts = splitTelegram((preview ? '🧪 TESTE — NÃO PREPARAR!\n\n' : '') + operatorText);
    let started = false;
    let firstTelegramMessageId = null;
    try {
        for (const [index, part] of parts.entries()) {
            started = true;
            const send = await fetch('https://api.telegram.org/bot' + config.token + '/sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: config.chat,
                    text: parts.length > 1 ? 'Parte ' + (index + 1) + '/' + parts.length + '\n' + part : part,
                    link_preview_options: { is_disabled: true },
                    reply_markup: index === 0 ? {
                        inline_keyboard: [[{ text: '💬 Chamar cliente no WhatsApp', url: whatsAppLink }]]
                    } : undefined
                }),
                signal: AbortSignal.timeout(8000)
            });
            const data = await send.json();
            if (!send.ok || data.ok !== true) throw new Error('Falha Telegram');
            if (index === 0 && Number.isSafeInteger(data.result?.message_id)) {
                firstTelegramMessageId = data.result.message_id;
            }
        }
        // O segundo envio é o cupom térmico anexado ao mesmo pré-pedido.
        // É PDF, não comando de impressão: o equipamento físico exige
        // conexão local configurada e homologada à parte.
        const form = new FormData();
        form.set('chat_id', config.chat);
        form.set('caption', (preview ? '🧪 TESTE — NÃO PREPARAR!\n' : '') +
            '🧾 CUPOM TÉRMICO — PRÉ-PEDIDO #' + id + '\n' +
            '⚠️ AGUARDANDO CONFIRMAÇÃO DO CLIENTE PELO WHATSAPP. NÃO PREPARAR.\n' +
            'Subtotal dos produtos: ' + money(subtotal) + '\n' +
            (deliveryDetails.type === 'delivery'
                ? 'Frete e total final: A CONFIRMAR PELA LOJA.'
                : 'Pagamento: A CONFIRMAR.'));
        form.set('document', new Blob([receipt], { type: 'application/pdf' }),
            (preview ? 'TESTE-NAO-PREPARAR-' : 'PRE-PEDIDO-') + id + '-cupom-termico.pdf');
        if (firstTelegramMessageId !== null) {
            form.set('reply_to_message_id', String(firstTelegramMessageId));
        }
        started = true;
        const sentReceipt = await fetch('https://api.telegram.org/bot' + config.token + '/sendDocument', {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(12000)
        });
        const receiptResult = await sentReceipt.json();
        if (!sentReceipt.ok || receiptResult.ok !== true) throw new Error('Falha no cupom Telegram');
        if(persisted){
            try {
                await backoffice.patchOrder(requestId,{telegram_state:'eq.pending'},{telegram_state:'sent'});
            }catch{
                return res.status(202).json({id,pending:true,
                    error:'A loja pode ter recebido o pré-pedido, mas o registro no painel requer conferência. Não reenvie.'});
            }
        }
        console.info(JSON.stringify({ event: 'whatsapp_intent', id, status: 'registered', receipt: true, preview }));
        return res.status(201).json({ id, status: 'registered', test: preview });
    } catch {
        if(persisted){
            try { await backoffice.patchOrder(requestId,{telegram_state:'eq.pending'},{telegram_state:'uncertain'}); }
            catch { /* Status incerto deve ser conferido manualmente. */ }
        }
        console.warn(JSON.stringify({ event: 'whatsapp_intent', id, status: 'uncertain', preview }));
        // Pode ter chegado ao Telegram mesmo se a resposta falhar. Não reenviar automaticamente.
        return res.status(202).json({
            id, pending: true,
            error: started
                ? 'O pré-pedido pode ter chegado ao bot, mas não foi possível confirmar o cupom. Não reenvie automaticamente; confirme com a loja pelo WhatsApp.'
                : 'Não foi possível registrar no bot. Fale com a loja pelo WhatsApp.'
        });
    }
};
