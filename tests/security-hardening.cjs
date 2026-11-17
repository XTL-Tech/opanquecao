'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync('cardapio.json', 'utf8'));

const common = config.headers.find(rule => rule.source === '/(.*)');
assert.ok(common, 'All public routes need security headers');
const header = key => common.headers.find(entry => entry.key.toLowerCase() === key.toLowerCase())?.value;
assert.match(header('Content-Security-Policy') || '', /frame-ancestors 'none'/);
assert.match(header('Content-Security-Policy') || '', /object-src 'none'/);
assert.equal(header('X-Content-Type-Options'), 'nosniff');
assert.equal(header('X-Frame-Options'), 'DENY');
assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin');

assert.match(html, /href="\/privacidade\.html"/);
assert.match(html, /id="analyticsAccept"/);
assert.match(html, /id="analyticsReject"/);
assert.doesNotMatch(html, /<noscript>[\s\S]*?facebook\.com\/tr\?/);
assert.match(html, /function escapeHtml\(value\)/);
assert.doesNotMatch(html, /li\.innerHTML\s*=\s*`[^`]*\$\{obs\}/);

const dom = new JSDOM(html, {url:'https://opanquecao.vercel.app/', runScripts:'outside-only'});
const w = dom.window, d = w.document;
w.HTMLElement.prototype.scrollIntoView = function(){};
const inline = [...d.querySelectorAll('script:not([src])')].at(-1)?.textContent;
assert.ok(inline?.includes('function renderMenu(data)'), 'Menu script missing');
w.eval(inline.replace(/\n\s*initMenu\(\);\s*$/, ''));
const poisoned = JSON.parse(JSON.stringify(catalog));
poisoned.categorias[0].titulo = '<img src=x onerror=alert(1)>';
poisoned.categorias[0].itens[0].nome = 'Produto "><img src=x onerror=alert(1)>';
poisoned.categorias[0].itens[0].sub = '<svg/onload=alert(1)>';
poisoned.categorias[0].itens[0].tags = ['<img src=x onerror=alert(1)>'];
poisoned.observacoes = ['<img src=x onerror=alert(1)>'];
w.renderMenu(poisoned);
assert.equal(d.querySelectorAll('img[src="x"],svg[onload]').length, 0, 'Catalog data became active HTML');
assert.ok(d.querySelector('#menuContent').textContent.includes('Produto "><img src=x onerror=alert(1)>'));
assert.ok(d.querySelector('#observationsList').textContent.includes('<img src=x onerror=alert(1)>'));
console.log('PASS: security headers, privacy consent controls and catalog HTML injection regression.');
