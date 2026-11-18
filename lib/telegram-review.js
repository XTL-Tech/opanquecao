'use strict';
const {UUID_V4}=require('./order-idempotency');
const REASONS=Object.freeze({
 p:'Produto indisponível',e:'Endereço fora da área de entrega',
 c:'Loja sem capacidade para atender',d:'Endereço insuficiente; entre em contato com a loja',
 f:'Loja fechada antes da aprovação'
});
const buttonsForOrder=id=>({inline_keyboard:[[
 {text:'Aprovar pedido',callback_data:'a:'+id},{text:'Rejeitar',callback_data:'r:'+id}
]]});
const buttonsForRejection=id=>({inline_keyboard:[
 ...Object.entries(REASONS).map(([code,reason])=>[{text:reason,callback_data:'x:'+code+':'+id}]),
 [{text:'Voltar',callback_data:'b:'+id}]
]});
function whatsappUrl(phone,name,id){
 if(typeof phone!=='string'||! /^\d{10,11}$/.test(phone))throw new TypeError('Telefone inválido');
 const message='Olá, '+String(name).slice(0,80)+'! Aqui é do Disk Panquecão. Seu pré-pedido #'+id+
  ' foi aprovado pela nossa equipe. Vamos confirmar os detalhes. Ficou com alguma dúvida ou deseja informar algo mais?';
 return 'https://wa.me/55'+phone+'?text='+encodeURIComponent(message);
}
const approvedButtons=(phone,name,id)=>({inline_keyboard:[[
 {text:'WhatsApp: confirmar com cliente',url:whatsappUrl(phone,name,id)}
]]});
async function telegramCall(method,payload){
 const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw new Error('Bot não configurado');
 let r;try{r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)
 });}catch{throw new Error('Falha de conexão Telegram');}
 const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error('Telegram recusou a operação');
 return j.result;
}
function parseCallback(data){
 if(typeof data!=='string'||data.length>64)return null;
 let m=/^([arb]):([0-9a-f-]{36})$/.exec(data);
 if(m&&UUID_V4.test(m[2]))return {action:m[1],id:m[2]};
 m=/^x:([pecdf]):([0-9a-f-]{36})$/.exec(data);
 if(m&&UUID_V4.test(m[2]))return {action:'x',reason:REASONS[m[1]],id:m[2]};
 return null;
}
module.exports={REASONS,buttonsForOrder,buttonsForRejection,approvedButtons,telegramCall,parseCallback};
