'use strict';
const crypto=require('node:crypto');
const RESTAURANT='opanquecao';
const ORDER_STATES=['pending_customer','awaiting_acceptance','accepted','completed','delivered','cancelled'];
const FLOW=Object.freeze({
  pending_customer:['awaiting_acceptance','cancelled'],
  awaiting_acceptance:['accepted','cancelled'],
  accepted:['completed','cancelled'],
  completed:['delivered','cancelled'],
  delivered:[],
  cancelled:[]
});
const METHODS=['cash','pix','credit','debit','other'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tidy=(value,max=160)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max+1);
function fail(reason){const e=new Error(reason);e.isValidation=true;throw e;}
function name(value){const s=tidy(value,80);if(s.length<2||s.length>80)fail('Informe o nome com 2 a 80 caracteres.');return s;}
function phone(value) {
  let s=String(value??'').replace(/\D/g,'');
  if(s.startsWith('55')&&(s.length===12||s.length===13))s=s.slice(2);
  if(!/^[1-9]\d{9,10}$/.test(s))fail('Telefone com DDD inválido.');
  return s;
}
function note(value,max=500){const s=tidy(value,max);if(s.length>max)fail('Observação muito longa.');return s;}
function cents(value,max=1000000){if(!Number.isSafeInteger(value)||value<0||value>max)fail('Valor monetário inválido.');return value;}
function isoDate(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Data inválida.');return value;}
function businessDate(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function statusAllowed(from,to){return !!FLOW[from]?.includes(to);}
function formatPrice(value){const n=cents(value);if(n===0)fail('O preço deve ser superior a zero.');return 'R$ '+(n/100).toFixed(2).replace('.',',');}
function applyPrice(catalog,change){
 if(!catalog||!Array.isArray(catalog.categorias))fail('Catálogo inválido.');
 const copy=structuredClone(catalog);
 const {category,product,variant,priceCents}=change||{};
 const cat=copy.categorias.find(x=>x.id===category),item=cat?.itens?.find(x=>x.nome===product);
 if(!item||typeof variant!=='string')fail('Produto não encontrado no cardápio.');
 const price=formatPrice(priceCents);
 if(variant==='preco'&&Object.hasOwn(item,'preco')&&/^R\$|^Consultar$/.test(item.preco)){
   item.preco=price;
 }else if(variant.startsWith('size:')&&item.tamanhos&&Object.hasOwn(item.tamanhos,variant.slice(5))){
   item.tamanhos[variant.slice(5)]=price;
 }else if(variant.startsWith('acai:')&&Array.isArray(item.tamanhos_acai)){
   const option=item.tamanhos_acai.find(x=>x.tamanho===variant.slice(5)&&typeof x.preco==='string');
   if(!option)fail('Opção de açaí inexistente.');
   option.preco=price;
 }else fail('Opção de preço inválida.');
 return copy;
}
function digest(object){return crypto.createHash('sha256').update(JSON.stringify(object)).digest('hex');}
function orderTotal(order){
 if(order.fulfillment?.type==='delivery'&&order.delivery_fee_cents===null)return null;
 return order.subtotal_cents+(order.delivery_fee_cents||0);
}
function tally(orders,date){
 const result={orders:0,total_cents:0,cash_cents:0,pix_cents:0,credit_cents:0,debit_cents:0,other_cents:0};
 for(const o of orders){
  if(o.status!=='delivered'||o.payment_status!=='paid'||o.settled_business_date!==date)continue;
  const v=orderTotal(o);
  if(!Number.isSafeInteger(v)||!METHODS.includes(o.payment_method))continue;
  result.orders++;result.total_cents+=v;result[o.payment_method+'_cents']+=v;
 }
 return result;
}
module.exports={RESTAURANT,ORDER_STATES,FLOW,METHODS,UUID,tidy,name,phone,note,cents,isoDate,businessDate,statusAllowed,formatPrice,applyPrice,digest,orderTotal,tally,fail};
