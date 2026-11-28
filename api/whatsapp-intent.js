'use strict';

const { orderPdf } = require('../lib/order-pdf');
const backoffice=require('../lib/backoffice-neon');
const digital=require('../lib/digital-orders');
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
    const guest=digital.enabled()&&fulfillment?.type==='table'&&!phone;
    const normalizedPhone = guest?null:normalizePhone(phone);
    if (!REQUEST_ID.test(requestId) || typeof name !== 'string' || !clean(name, 80) ||
        name.length > 80 || /[\r\n]/.test(name) || (!guest&&!normalizedPhone) ||
        typeof note !== 'string' || note.length > 400 ||
        typeof challenge !== 'string' || challenge.length < 1 || challenge.length > 2048) {
        return res.status(400).json({ error: 'Confira nome, WhatsApp e dados do pré-pedido.' });
    }
    let deliveryDetails, deliveryFeeCents=null;
    try {
        const functions = await import('../fulfillment.mjs');
        deliveryDetails = functions.normalizeFulfillment(fulfillment, deliveryAreas);
        if(deliveryDetails.type==='delivery')deliveryFeeCents=functions.standardDeliveryFee(deliveryDetails.city,fulfillment.neighborhood,deliveryAreas);
    } catch (error) {
        return res.status(400).json({ error: error?.message || 'Confira o endereço e a modalidade do pedido.' });
    }
    let accountSubject=null;
    if(deliveryDetails.type==='delivery'&&(digital.enabled()||require('../lib/customer-cpf').enabled())){
        try{accountSubject=await require('../lib/customer-cpf').requireDeliveryAccount(req,clean(name,80),normalizedPhone);}
        catch(e){return res.status([401,403].includes(e.status)?e.status:503).json({error:[401,403].includes(e.status)?e.message:'Não foi possível validar sua conta.'});}
    }
    // Fail closed: nunca informar a equipe de que um pedido é válido sem
    // conferir catálogo e horário no servidor.
    try {
        const status = await loadStoreStatus();
        if(digital.enabled()&&!status.enabled)return res.status(503).json({error:'Horário de atendimento não configurado.'});
        if (status.enabled && !status.open) {
            return res.status(423).json({ error: 'A loja está fechada para novos pedidos.' });
        }
    } catch {
        return res.status(503).json({ error: 'Não foi possível verificar o horário da loja.' });
    }
    let validated;
    let money;
    try {
        const catalog = await loadCatalog();
        ({ money } = await import('../order-catalog.mjs'));
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
    if(digital.enabled()){
        // Preview never writes to the restaurant DB or sends actual Telegram messages.
        if(preview||!backoffice.configured()||process.env.CATALOG_SOURCE!=='neon')return res.status(503).json({error:'Pedidos digitais indisponíveis neste ambiente.'});
        if(deliveryDetails.type==='delivery'&&!accountSubject)return res.status(403).json({error:'Entre na sua conta.'});
        let claimed;
        try{
            if(!await digital.preflight())return res.status(423).json({error:'Loja fechada ou atendimento digital indisponível.'});
            const customer=accountSubject?await digital.customerForAccount(accountSubject,clean(name,80),normalizedPhone):guest?await digital.guestCustomer(requestId,clean(name,80)):await backoffice.upsertCustomer({name:clean(name,80),phone:normalizedPhone});
            claimed=await backoffice.createOrder({requestId,customer,items:validated,fulfillment:deliveryDetails,note:clean(note,400),origin:'site',status:'awaiting_acceptance',telegramState:'pending',deliveryFeeCents,accountSubject,contact:{name:clean(name,80),phone:normalizedPhone}});
        }catch(e){return res.status(e.status===409?409:503).json({error:'Não foi possível confirmar o registro. Confira antes de reenviar.'});}
        const reply={id,status:'registered',digital:true,test:false,tracking:false,prepaidPix:digital.prepaid(deliveryDetails),deliveryFeeCents:claimed.record.delivery_fee_cents??null};
        if(!claimed.created)return res.status(200).json({...reply,replayed:true,telegramConfirmed:claimed.record.telegram_state==='sent'});
        try{
            const keyboard=[];
            if(require('../lib/telegram-approval').approvalEnabled())keyboard.push([{text:'Aceitar pedido',callback_data:'accept:'+requestId},{text:'Rejeitar pedido',callback_data:'reject:'+requestId}]);
            if(normalizedPhone)keyboard.push([{text:'Contato WhatsApp',url:'https://wa.me/55'+normalizedPhone}]);
            const loc=deliveryDetails.location;
            if(loc)keyboard.push([{text:'Ver rota de entrega',url:'https://www.google.com/maps?q='+loc.latitude+','+loc.longitude}]);
            const response=await fetch('https://api.telegram.org/bot'+config.token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:config.chat,text:digital.orderText({id,name,phone:normalizedPhone,items:validated,fulfillment:deliveryDetails,note,deliveryFeeCents}),reply_markup:{inline_keyboard:keyboard}}),signal:AbortSignal.timeout(12000)});
            const sent=await response.json();
            if(!response.ok||sent.ok!==true)throw Error('telegram');
            await backoffice.patchOrder(requestId,{telegram_state:'eq.pending'},{telegram_state:'sent'});
            return res.status(201).json({...reply,telegramConfirmed:true});
        }catch{
            try{await backoffice.patchOrder(requestId,{telegram_state:'eq.pending'},{telegram_state:'uncertain'});}catch{}
            // The database has already committed. Do not ask the customer to reorder.
            return res.status(201).json({...reply,telegramConfirmed:false});
        }
    }
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
            items: validated, subtotal, money, note: clean(note, 400),
            fulfillment: { ...deliveryDetails, feeCents: deliveryFeeCents },
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
                note:clean(note,400),origin:'site',status:'pending_customer',telegramState:'pending',deliveryFeeCents,accountSubject
            });
            if (!claimed.created) {
                return claimed.record.telegram_state==='sent'
                    ? res.status(201).json({id,status:'registered',test:false,replayed:true,tracking:deliveryDetails.type==='delivery',deliveryFeeCents:claimed.record.delivery_fee_cents??null})
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
    let started = false;
    try {
        // Um único envio, com aviso, PDF e botão. Dados do pedido ficam no PDF.
        const form = new FormData();
        form.set('chat_id', config.chat);
        form.set('caption', (preview ? '🧪 TESTE — NÃO PREPARAR!\n' : '') +
            '🔔 NOVO PEDIDO\nAguardando confirmação pelo WhatsApp.');
        const keyboard = [[{ text: '💬 Confirmar pedido com cliente', url: whatsAppLink }]];
        if (persisted && require('../lib/telegram-approval').approvalEnabled()) {
            keyboard.push([{ text: '✅ Aprovar pedido — liberar produção', callback_data: 'accept:' + requestId }]);
        }
        form.set('reply_markup', JSON.stringify({ inline_keyboard: keyboard }));
        form.set('document', new Blob([receipt], { type: 'application/pdf' }),
            (preview ? 'TESTE-NAO-PREPARAR-' : 'PRE-PEDIDO-') + id + '-cupom-termico.pdf');
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
        return res.status(201).json({ id, status: 'registered', test: preview, tracking: persisted && deliveryDetails.type==='delivery',deliveryFeeCents });
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
