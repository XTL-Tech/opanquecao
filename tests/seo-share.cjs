'use strict';
// Auditoria de SEO local, links para compartilhamento, dados estruturados e deep-links.
// Sem chamadas a serviços de terceiros nem disparo de pedidos.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.resolve(p),'utf8');
const catalog=JSON.parse(read('cardapio.json'));
const site='https://opanquecao.vercel.app';
const home=read('index.html');
const homeDoc=new JSDOM(home).window.document;
const profile=JSON.parse(read('ai/business.json'));
const ld=JSON.parse(homeDoc.querySelector('script[type="application/ld+json"]').textContent);
assert.equal(ld['@type'],'Restaurant');
assert.equal(ld.name,'Disk Panquecão');
assert.equal(ld.hasMenu,site+'/');
assert.equal(ld.menu,site+'/');
assert.ok(ld.logo?.endsWith('.png'));
assert.ok(!('openingHoursSpecification' in ld),'Horários não verificados não podem ser estruturados como oficiais');
assert.equal(homeDoc.querySelector('meta[property="og:image"]')?.content,site+'/img/logo-disk-panquecao.png');
assert.equal(homeDoc.querySelector('meta[name="twitter:card"]')?.content,'summary_large_image');
assert.equal(homeDoc.querySelector('meta[property="og:image:alt"]')?.content.includes('Disk Panquecão'),true);
assert.equal(homeDoc.querySelectorAll('.footer-category-links a').length,12);
assert.equal(homeDoc.querySelector('#shareCategory')?.hidden,true);
const siteMap=read('sitemap.xml');
assert.equal((siteMap.match(/<loc>/g)||[]).length,13,'Homepage + 12 categorias');
assert.match(read('robots.txt'),/Disallow: \/api\/whatsapp-intent/);
assert.match(read('robots.txt'),/Sitemap: https:\/\/opanquecao\.vercel\.app\/sitemap\.xml/);
assert.equal(profile.delivery.cities.length,2);
for(const city of profile.delivery.cities)assert.equal(city.standard_fee_brl,undefined,'Não anunciar taxa de entrega antiga');
assert.match(profile.delivery.fee_policy,/NÃO é calculada/i);
assert.equal(profile.orders.payment_method_collected_during_checkout,false);
assert.equal(profile.menu.category_pages.length,12);
for(const doc of ['llms.txt','llms-full.txt','ai/faq.md','ai/agents.md']){
 assert.doesNotMatch(read(doc),/Taxas? (?:base|padrão|iniciais?) [^\n]{0,200}R\$\s*7|Nova Hartz R\$\s*7|Araricá R\$\s*10/i,doc+' taxas antigas');
}
let total=0;
for(const category of catalog.categorias){
 const slug=category.id;
 const url=site+'/categorias/'+slug+'.html';
 const file='categorias/'+slug+'.html';
 const doc=new JSDOM(read(file)).window.document;
 const canonical=doc.querySelector('link[rel=canonical]');
 assert.equal(canonical?.href,url,'canonical errado: '+slug);
 assert.equal(doc.querySelector('meta[property="og:url"]')?.content,url,'og:url errado: '+slug);
 assert.match(doc.title,/Disk Panquecão/);
 assert.ok(doc.querySelector('meta[name=description]')?.content.length>=70,'Descrição curta: '+slug);
 assert.ok(doc.querySelector('meta[property="og:image"]')?.content.includes('/img/cardapio/'),'Imagem da categoria: '+slug);
 assert.ok(doc.querySelector('meta[name="twitter:card"]'),'Twitter card ausente: '+slug);
 assert.equal(doc.querySelectorAll('h1').length,1,'H1 exclusivo: '+slug);
 assert.equal(doc.querySelectorAll('.category-nav a').length,12,'Links internos das categorias: '+slug);
 assert.equal(doc.querySelectorAll('li.product').length,category.itens.length,
    'Quantidade e produtos reais no HTML inicial: '+slug);
 const schema=JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
 assert.equal(schema['@type'],'WebPage');
 assert.equal(schema.about['@type'],'MenuSection');
 assert.equal(schema.about.hasMenuItem.length,category.itens.length);
 for(const [i,item] of category.itens.entries()){
   const node=doc.querySelectorAll('li.product')[i];
   assert.equal(node.querySelector('strong')?.textContent,item.nome,'Nome errado em '+slug);
   assert.equal(schema.about.hasMenuItem[i]?.name,item.nome,'MenuItem JSON-LD errado em '+slug);
   assert.ok(node.querySelector('img')?.alt.includes(item.nome),'Imagem sem alt em '+slug);
   const link=new URL(node.querySelector('a.product-link').getAttribute('href'),site);
   assert.equal(link.origin,site);
   assert.equal(link.searchParams.get('categoria'),slug,'Deep-link categoria incorreta: '+slug);
   assert.equal(link.searchParams.get('produto'),item.nome,'Deep-link produto incorreto: '+slug);
   assert.equal(link.hash,'#'+slug);
   total++;
 }
 assert.ok(siteMap.includes('<loc>'+url+'</loc>'),'Categoria fora do sitemap: '+slug);
 assert.ok(homeDoc.querySelector('.footer-category-links a[href="/categorias/'+slug+'.html"]'),
    'Sem link rastreável na home: '+slug);
 assert.ok(profile.menu.category_pages.some(p=>p.category===slug&&p.url===url),
    'Categoria ausente no perfil público: '+slug);
}
assert.equal(total,82);
(async()=>{
 // Navegação real por link recebido: a ficha correta abre sem exigir nova busca.
 const w=new JSDOM(home,{url:site+'/?categoria=panquecas-salgadas&produto=Carne%20de%20Panela#panquecas-salgadas',runScripts:'outside-only'}).window;
 const d=w.document;
 Object.assign(global,{window:w,document:d,Option:w.Option});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 const inline=[...d.querySelectorAll('script:not([src])')].at(-1).textContent;
 w.eval(inline.replace(/\n\s*initMenu\(\);\s*$/,''));
 await import(path.resolve('cart.mjs'));
 w.renderMenu(catalog);
 d.dispatchEvent(new w.CustomEvent('menu-ready',{detail:catalog}));
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(d.getElementById('panquecas-salgadas').hidden,false,'Deep-link deve abrir categoria');
 assert.equal(d.getElementById('productDialog').open,true,'Deep-link deve abrir ficha');
 assert.match(d.getElementById('productDialogTitle').textContent,/Carne de Panela/,
    'Deep-link abriu ficha errada');
 assert.match(d.querySelector('#productDialogContent form.order-form .order-primary').textContent,/30,00/,
    'Preço inicial do produto compartilhado não bate com catálogo');
 console.log('PASS SEO/COMPARTILHAMENTO: 12 páginas indexáveis, 82 produtos e links específicos, 13 URLs no sitemap, OG, Twitter, política comercial coerente e deep-link funcional.');
})().catch(e=>{console.error(e);process.exitCode=1});
