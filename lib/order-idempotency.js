'use strict';

const { createHash } = require('node:crypto');

class OrderLedgerUnavailable extends Error {}

const RESTAURANT_ID = 'opanquecao';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isEnabled() { return process.env.ORDER_LEDGER_MODE === 'required'; }

function payloadDigest({ name, phone, items, delivery, payment }) {
    // Nunca armazenar nome, telefone, endereço ou itens na tabela de idempotência.
    return createHash('sha256').update(JSON.stringify({ name, phone, items, delivery, payment })).digest('hex');
}

function initLedger() {
    if (!isEnabled()) return null;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) {
        throw new OrderLedgerUnavailable('Supabase de pedidos não configurado');
    }
    const base = url.replace(/\/$/, '') + '/rest/v1/restaurant_order_intents';
    const authHeaders = { apikey: key, Accept: 'application/json' };
    const rowFilter = requestId => '?restaurant_id=eq.' + RESTAURANT_ID +
        '&request_id=eq.' + encodeURIComponent(requestId);

    async function request(path, options = {}) {
        let response;
        try {
            response = await fetch(base + path, {
                ...options,
                cache: 'no-store',
                headers: { ...authHeaders, ...(options.headers || {}) },
                signal: AbortSignal.timeout(5000)
            });
        } catch {
            throw new OrderLedgerUnavailable('Conexão com ledger indisponível');
        }
        if (!response.ok) throw new OrderLedgerUnavailable('Erro de persistência do ledger');
        return response;
    }

    async function lookup(requestId) {
        const response = await request(rowFilter(requestId) +
            '&select=request_id,payload_sha256,status,order_ref&limit=1');
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new OrderLedgerUnavailable('Resposta inválida do ledger');
        return rows[0] || null;
    }

    async function claim({ requestId, digest, orderRef }) {
        const response = await request('?on_conflict=restaurant_id,request_id', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Prefer: 'resolution=ignore-duplicates,return=representation'
            },
            body: JSON.stringify({
                restaurant_id: RESTAURANT_ID,
                request_id: requestId,
                payload_sha256: digest,
                order_ref: orderRef,
                status: 'processing'
            })
        });
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new OrderLedgerUnavailable('Resposta inválida do claim');
        // A chave primária no PostgreSQL garante uma única criação mesmo em corrida.
        return rows.length === 1;
    }

    async function finish(requestId, status, messageId = null) {
        if (!['delivered', 'needs_review'].includes(status)) throw new TypeError('Estado inválido');
        await request(rowFilter(requestId) + '&status=eq.processing', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
                status,
                telegram_message_id: Number.isSafeInteger(messageId) ? messageId : null,
                updated_at: new Date().toISOString()
            })
        }).then(async response => {
            const rows = await response.json();
            if (!Array.isArray(rows) || rows.length !== 1) {
                throw new OrderLedgerUnavailable('O ledger não confirmou a atualização');
            }
        });
    }

    return { lookup, claim, finish };
}

function replayResponse(row, digest) {
    if (!row) return null;
    if (row.payload_sha256 !== digest) {
        return { httpStatus: 409, body: { error: 'Identificador de pedido utilizado em outra solicitação. Reabra o carrinho e confira.' } };
    }
    if (row.status === 'delivered') {
        return { httpStatus: 200, body: { id: row.order_ref, test: process.env.VERCEL_ENV !== 'production', replayed: true } };
    }
    return {
        httpStatus: 202,
        body: { id: row.order_ref, pending: true,
            error: 'A situação deste pedido requer confirmação da loja. Não reenvie automaticamente.' }
    };
}
module.exports = { UUID_V4, OrderLedgerUnavailable, isEnabled, payloadDigest, initLedger, replayResponse };
