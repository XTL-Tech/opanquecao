'use strict';
const db=require('./backoffice-neon');
const {loadStoreStatus}=require('./store-hours-source');
const areas=require('../delivery-areas.json');
const prepaid=f=>f?.type==='delivery'&&areas.prepaidPixCities?.includes(f.city)===true;
const enabled=()=>process.env.DIGITAL_ORDERS_ENABLED==='true';
const live=()=>process.env.VERCEL_ENV==='production';
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const safe=(v,n=400)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n);
function orderText({id,name,phone,items,fulfillment,note,deliveryFeeCents}){
 const subtotal=items.reduce((n,i)=>n+i.cents*i.quantity,0);
 const mode=fulfillment.type==='table'?'PRESENCIAL · Mesa '+safe(fulfillment.table,12):fulfillment.type==='pickup'?'RETIRADA':'DELIVERY';
 const address=fulfillment.type==='delivery'?[fulfillment.street,fulfillment.number,fulfillment.neighborhood,fulfillment.city,fulfillment.complement,fulfillment.reference].filter(Boolean).map(v=>safe(v,140)).join(', '):'';
 const details=items.map(i=>[i.quantity+'x '+safe(i.product,120)+' · '+safe(i.option,80)+' · '+money(i.quantity*i.cents),...(i.flavors||[]).map(x=>safe(typeof x==='string'?x:JSON.stringify(x),150)),...(i.freeExtras||[]).map(x=>safe(typeof x==='string'?x:JSON.stringify(x),150)),...(i.paidExtras||[]).map(x=>safe(typeof x==='string'?x:JSON.stringify(x),150)),i.note?'Obs.: '+safe(i.note):''].filter(Boolean).join('\n')).join('\n\n');
 const total=fulfillment.type==='delivery'&&deliveryFeeCents===null?'Frete a confirmar':money(subtotal+(deliveryFeeCents||0));
 const text=['NOVO PEDIDO #'+id,mode,safe(name,80),phone?'Contato: '+safe(phone,20):'',address,details,note?'Observação: '+safe(note):'','Subtotal: '+money(subtotal),fulfillment.type==='delivery'?'Tele-entrega: '+(deliveryFeeCents===null?'A confirmar':money(deliveryFeeCents)):'Sem frete','Total: '+total,prepaid(fulfillment)?'Pix obrigatório antes do preparo; aguarde confirmação da cobertura.':'','Aguardando decisão da loja.'].filter(Boolean).join('\n');
 // Telegram text limit. Do not silently truncate order lines: panel contains the full order.
 return text.length<=3900?text:['NOVO PEDIDO #'+id,mode,'Pedido extenso. Consulte todos os itens e observações no painel antes de decidir.','Subtotal: '+money(subtotal),'Total: '+total].join('\n');
}
async function preflight(){
 if(!db.configured()||!live()||process.env.STORE_HOURS_MODE!=='required'||process.env.STORE_HOURS_SOURCE!=='neon')return false;
 return (await loadStoreStatus()).open===true;
}
async function customerForAccount(subject,name,phone){
 // Do not claim a pre-existing phone-based customer: attach the order to its authenticated account.
 // Legacy customer row is merely a contact record; account_subject controls customer history.
 const rows=await db.run("INSERT INTO dp.customers(name,phone,account_subject) VALUES($1,NULL,$2) ON CONFLICT(account_subject) DO UPDATE SET name=excluded.name,updated_at=now() RETURNING id,name,phone",[name,subject]);
 return rows[0];
}
async function guestCustomer(requestId,name){
 const rows=await db.run('INSERT INTO dp.customers(id,name,phone) VALUES($1,$2,NULL) ON CONFLICT(id) DO NOTHING RETURNING id,name,phone',[requestId,name]);
 if(rows.length)return rows[0];
 const old=(await db.run('SELECT id,name,phone FROM dp.customers WHERE id=$1 AND phone IS NULL',[requestId]))[0];
 if(!old||old.name!==name)throw new db.StoreError('Identificador de pedido reutilizado.',409);
 return old;
}
module.exports={enabled,live,orderText,preflight,guestCustomer,customerForAccount,prepaid};
