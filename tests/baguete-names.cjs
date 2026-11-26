'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const html=fs.readFileSync('index.html','utf8');
const seed=fs.readFileSync('supabase/migrations/202611170002_seed_catalog.sql','utf8');
const category=catalog.categorias.find(c=>c.id==='paokecao');
assert.equal(category.titulo,'PÃOKECÃO');
assert.deepEqual(category.itens.map(p=>p.nome),[
  'Baguete Carne de Panela','Baguete Frango','Baguete Coração de Frango'
]);
assert.equal(catalog.categorias.length,12);
assert.equal(catalog.categorias.reduce((n,c)=>n+c.itens.length,0),82);
for(const [index,item] of category.itens.entries()){
 assert.equal(item.preco,'R$ 30,00');
 assert.match(item.ingredientes,/Pão baguete/);
 assert.ok(html.includes('"'+item.nome+'": "cardapio/c09-p0'+(index+1)+'.webp"'),
   'A foto existente deve continuar associada ao novo nome');
 assert.ok(seed.includes('"nome": "'+item.nome+'"'),'Nome divergente no catálogo inicial de homologação');
}
console.log('PASS: apenas os 3 nomes de baguetes, preços e fotos preservados');
