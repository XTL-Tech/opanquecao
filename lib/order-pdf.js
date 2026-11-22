const { PDFDocument, StandardFonts, PrintScaling, rgb } = require('pdf-lib');
const { createDirectionsQr } = require('./location-qr');
const { code128b } = require('./order-barcode');

async function orderPdf({ id, name, phone, items, subtotal, money, fulfillment, payment, testMode = false }) {
    const { orderProductName } = await import('../order-catalog.mjs');
    const mm = 72 / 25.4;
    const profile = process.env.ORDER_PRINT_WIDTH_MM || '58';
    const a4 = profile.toLowerCase() === 'a4';
    const widthMm = a4 ? 210 : Number(profile);
    const width = (widthMm >= 40 && widthMm <= 210 ? widthMm : 58) * mm;
    const margin = (a4 ? 18 : 5) * mm;
    const available = width - margin * 2;
    const pdf = await PDFDocument.create();
    pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const rows = [];
    function add(value, size = 10, font = regular) {
        let current = '';
        const chars = Array.from(String(value).replace(/\s+/gu, ' '), char => {
            try { font.encodeText(char); return char; } catch { return '?'; }
        }).join('').trim().split(' ');
        const output = line => rows.push({ text: line, size, font, height: size * 1.22 });
        for (const word of chars) {
            const candidate = current ? current + ' ' + word : word;
            if (font.widthOfTextAtSize(candidate, size) <= available) { current = candidate; continue; }
            if (current) output(current);
            current = '';
            for (const char of word) {
                if (font.widthOfTextAtSize(current + char, size) > available) { output(current); current = ''; }
                current += char;
            }
        }
        if (current) output(current);
    }
    const rule = () => rows.push({ height: 12 });
    if (testMode) {
        add('TESTE - NAO PREPARAR', 15, bold);
        add('PEDIDO FICTICIO - IGNORAR', 11, bold);
        rule();
    }
    add('DISK PANQUECÃO', 12, bold);
    add('PRÉ-PEDIDO #' + id, 12, bold);
    // Scan reference at top of every order (delivery, pickup or table).
    // Uses the exact existing public ID; no customer details in Code128.
    const barcode = code128b(id);
    if (barcode) {
        rows.push({ kind: 'order-barcode', barcode, height: 19 * mm });
        add('ID PARA APP: ' + id, 9, bold);
    }
    add('AGUARDANDO CONFIRMAÇÃO', 10, bold);
    rule();
    for (const item of items) {
        add(item.quantity + ' × ' + orderProductName(item).toLocaleUpperCase('pt-BR'), 16, bold);
        if (item.option !== 'Único') add('Opção: ' + item.option);
        if (item.flavors?.length === 2) {
            add('1o sabor: ' + item.flavors[0], 11, bold);
            add('2o sabor: ' + item.flavors[1], 11, bold);
        }
        if (item.freeExtras?.length) add('Grátis: ' + item.freeExtras.join(', '));
        if (item.paidExtras?.length) add('Adicionais pagos: ' + item.paidExtras.join(', '));
        if (item.note) add('Observação: ' + item.note);
        add(money(item.quantity * item.cents));
        rule();
    }
    add('CLIENTE E CONTATO', 10, bold);
    add(name);
    add(phone);
    rule();
    add('TIPO DE ATENDIMENTO', 10, bold);
    if (fulfillment?.type === 'delivery') {
        add('ENTREGA', 12, bold);
        add('Cidade: ' + fulfillment.city);
        add('Bairro: ' + fulfillment.neighborhood);
        add('Rua/estrada: ' + fulfillment.street);
        add('Número: ' + fulfillment.number);
        if (fulfillment.complement) add('Complemento: ' + fulfillment.complement);
        if (fulfillment.postalCode) add('CEP: ' + fulfillment.postalCode);
        if (fulfillment.reference) add('Referência: ' + fulfillment.reference);
        // O cliente só compartilha coordenadas se acionar "Usar minha localização".
        // QR gerado localmente: nenhuma chamada de API externa recebe o GPS.
        const directions = createDirectionsQr(fulfillment.location);
        if (directions) {
            const latitude = fulfillment.location.latitude.toFixed(6);
            const longitude = fulfillment.location.longitude.toFixed(6);
            add('GPS: ' + latitude + ', ' + longitude);
            add('ESCANEIE PARA ABRIR A ROTA', 11, bold);
            const side = Math.min(35 * mm, available);
            rows.push({ kind: 'location-qr', qr: directions, side, height: side + 8 });
        }
        add(fulfillment.feeCents === null
            ? 'Taxa de entrega: A CONFIRMAR' : 'Taxa de entrega: ' + money(fulfillment.feeCents), 11, bold);
        add('Prazo sujeito a confirmação da loja.');
    } else if (fulfillment?.type === 'pickup') {
        add('RETIRADA NO LOCAL', 12, bold);
        add('Aguardar confirmação de horário pela loja.');
    } else if (fulfillment?.type === 'table') {
        add('COMER NO LOCAL', 12, bold);
        add('Mesa: ' + fulfillment.table);
    }
    rule();
    add('Subtotal dos produtos: ' + money(subtotal), 11, bold);
    if (fulfillment?.type === 'delivery' && fulfillment.feeCents !== null) {
        add('Total com entrega: ' + money(subtotal + fulfillment.feeCents), 11, bold);
    }
    rule();
    add('FORMA DE PAGAMENTO', 10, bold);
    add('Previsto: ' + (payment?.label || 'A confirmar'), 11, bold);
    if (payment?.method === 'cash' && payment.changeForCents !== null) {
        add('Troco para: ' + money(payment.changeForCents), 11, bold);
        if (payment.changeCents !== null) {
            add('Troco estimado: ' + money(payment.changeCents), 11, bold);
        } else add('Troco: calcular apos confirmar a taxa.');
    }
    add('PAGAMENTO PENDENTE', 10, bold);
    add('Pedido sujeito a confirmação.');
    const height = a4 ? 297 * mm : Math.min(1000, rows.reduce((sum, row) => sum + row.height, 2 * margin));
    let page = pdf.addPage([width, height]);
    let y = height - margin;
    for (const row of rows) {
        if (y - row.height < margin - 0.001) {
            page = pdf.addPage([width, height]);
            y = height - margin;
        }
        y -= row.height;
        if (row.kind === 'order-barcode') {
            const quietModules = 10; // Code 128 requires >=10 x-dimension quiet zone.
            const barHeight = 15 * mm;
            const moduleSize = available / (row.barcode.modules.length + quietModules * 2);
            const x0 = (width - available) / 2 + quietModules * moduleSize;
            const bottom = y + (row.height - barHeight) / 2;
            let start = -1;
            const modules = row.barcode.modules;
            for (let i = 0; i <= modules.length; i++) {
                if (i < modules.length && modules[i] === '1') {
                    if (start === -1) start = i;
                } else if (start !== -1) {
                    page.drawRectangle({
                        x: x0 + start * moduleSize,
                        y: bottom,
                        width: (i - start) * moduleSize,
                        height: barHeight,
                        color: rgb(0, 0, 0),
                        borderWidth: 0
                    });
                    start = -1;
                }
            }
        } else if (row.kind === 'location-qr') {
            const quietZone = 4; // Mínimo de 4 módulos brancos: leitura por câmera/impressora térmica.
            const moduleSize = row.side / (row.qr.size + quietZone * 2);
            const left = (width - row.side) / 2;
            const bottom = y + (row.height - row.side) / 2;
            // Agrupar sequências horizontais reduz o tamanho do PDF e o custo do render.
            for (let r = 0; r < row.qr.size; r++) {
                let start = -1;
                for (let c = 0; c <= row.qr.size; c++) {
                    if (c < row.qr.size && row.qr.isDark(r, c)) {
                        if (start < 0) start = c;
                    } else if (start >= 0) {
                        page.drawRectangle({
                            x: left + (quietZone + start) * moduleSize,
                            y: bottom + (quietZone + row.qr.size - r - 1) * moduleSize,
                            width: (c - start) * moduleSize + 0.02,
                            height: moduleSize + 0.02,
                            color: rgb(0, 0, 0),
                            borderWidth: 0
                        });
                        start = -1;
                    }
                }
            }
        } else if (row.text) {
            page.drawText(row.text, { x: margin, y: y + row.height - row.size, size: row.size, font: row.font });
        } else {
            page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: width - margin, y: y + 6 }, thickness: 0.6 });
        }
    }
    return pdf.save();
}

module.exports = { orderPdf };
