'use strict';
const assert=require('node:assert/strict');
const {orderText}=require('../lib/digital-orders');
const base={id:'TESTE001',name:'Cliente fictício',phone:'',items:[{quantity:2,product:'Panqueca',option:'M',cents:2500,flavors:[],freeExtras:[],paidExtras:[],note:'Sem cebola'}],fulfillment:{type:'table',table:'4'},note:'',deliveryFeeCents:null};
const t=orderText(base);
assert.match(t,/PRESENCIAL · Mesa 4/);assert.match(t,/2x Panqueca/);assert.match(t,/Sem cebola/);assert.match(t,/50,00/);assert.doesNotMatch(t,/Frete a confirmar/);
assert.match(orderText({...base,fulfillment:{type:'delivery',city:'Teste'}}),/Frete a confirmar/);
assert.match(orderText({...base,items:Array(80).fill({...base.items[0],product:'A'.repeat(120)})}),/Consulte todos os itens/);
console.log('digital-orders: texto, modalidade, total e limite OK');
