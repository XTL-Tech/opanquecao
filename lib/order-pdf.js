const { PDFDocument, StandardFonts, PrintScaling } = require('pdf-lib');

async function orderPdf({ id, name, phone, items, subtotal, money, fulfillment }) {
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
    add('DISK PANQUECÃO', 12, bold);
    add('PRÉ-PEDIDO #' + id, 12, bold);
    add('AGUARDANDO CONFIRMAÇÃO', 10, bold);
    rule();
    for (const item of items) {
        add(item.quantity + ' × ' + item.product.toLocaleUpperCase('pt-BR'), 16, bold);
        if (item.option !== 'Único') add('Opção: ' + item.option);
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
        add('Endereço: ' + fulfillment.address);
        if (fulfillment.location) {
            const latitude = fulfillment.location.latitude.toFixed(6);
            const longitude = fulfillment.location.longitude.toFixed(6);
            add('GPS: ' + latitude + ', ' + longitude);
            add('Mapa: https://maps.google.com/?q=' + latitude + ',' + longitude);
        }
        add('Prazo e taxa sob confirmação da loja.');
    } else if (fulfillment?.type === 'pickup') {
        add('RETIRADA NO LOCAL', 12, bold);
        add('Aguardar confirmação de horário pela loja.');
    } else if (fulfillment?.type === 'table') {
        add('COMER NO LOCAL', 12, bold);
        add('Mesa: ' + fulfillment.table);
    }
    rule();
    add('Subtotal: ' + money(subtotal), 11, bold);
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
        if (row.text) page.drawText(row.text, { x: margin, y: y + row.height - row.size, size: row.size, font: row.font });
        else page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: width - margin, y: y + 6 }, thickness: 0.6 });
    }
    return pdf.save();
}

module.exports = { orderPdf };
