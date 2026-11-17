'use strict';
/**
 * QR do motoboy impresso em PDF como vetores, sem serviços de terceiros para geração.
 * A geolocalização é opcional e só deve ser recebida quando o comprador autorizou.
 * Origem do encoder MIT: lib/vendor/qrcode-generator.js.
 */
const qrcode = require('./vendor/qrcode-generator');

function directionsUrl(location) {
    if (!location || typeof location !== 'object') return null;
    const { latitude, longitude } = location;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

    const destination = latitude.toFixed(6) + ',' + longitude.toFixed(6);
    const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
    return 'https://www.google.com/maps/dir/?' + params.toString();
}

function createDirectionsQr(location) {
    const url = directionsUrl(location);
    if (!url) return null;
    const qr = qrcode(0, 'M');
    qr.addData(url, 'Byte');
    qr.make();
    return { url, size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

module.exports = { directionsUrl, createDirectionsQr };
