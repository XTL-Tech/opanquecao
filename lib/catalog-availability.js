'use strict';
const db=require('./backoffice-neon');
function applyAvailability(catalog,{category,product,available}){
 if(typeof category!=='string'||typeof product!=='string'||typeof available!=='boolean')throw new db.StoreError('Seleção de disponibilidade inválida.',400);
 const next=structuredClone(catalog);
 const item=next.categorias.find(c=>c.id===category)?.itens.find(i=>i.nome===product);
 if(!item)throw new db.StoreError('Produto não encontrado.',404);
 const previous=item.available!==false;
 if(available)delete item.available;else item.available=false;
 return {catalog:next,previous,changed:previous!==available};
}
function publicCatalog(catalog){
 const next=structuredClone(catalog);
 for(const c of next.categorias)c.itens=c.itens.filter(i=>i.available!==false);
 return next;
}
async function change({category,product,available,revision,actorId}){
 if(process.env.CATALOG_SOURCE!=='neon')throw new db.StoreError('Cardápio não vinculado ao banco.',409);
 const current=await db.getCatalog();
 if(!Number.isInteger(revision)||revision!==current.revision)throw new db.StoreError('Cardápio alterado em outra sessão.',409);
 const next=applyAvailability(current.catalog,{category,product,available});
 if(!next.changed)return current;
 const rows=await db.run('WITH upd AS (UPDATE dp.catalog SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=\'opanquecao\' AND revision=$2 RETURNING data,revision,updated_at), hist AS (INSERT INTO dp.catalog_availability_events(category,product,previous_available,available,actor_id) SELECT $3,$4,$5,$6,$7 FROM upd RETURNING id) SELECT upd.* FROM upd JOIN hist ON TRUE',[JSON.stringify(next.catalog),revision,category,product,next.previous,available,actorId]);
 if(rows.length!==1)throw new db.StoreError('Cardápio alterado em outra sessão.',409);
 return {catalog:rows[0].data,revision:rows[0].revision,updated_at:rows[0].updated_at};
}
module.exports={applyAvailability,publicCatalog,change};
