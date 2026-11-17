'use strict';
const {timingSafeEqual}=require('node:crypto');
const {enabled,initReviewStore}=require('../lib/order-review');
const {parseCallback,buttonsForOrder,buttonsForRejection,approvedButtons,telegramCall}=require('../lib/telegram-review');
function fixedEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const aa=Buffer.from(a),bb=Buffer.from(b);
 return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function authorized(actorId){
 const ids=(process.env.TELEGRAM_REVIEWER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return ids.length>0&&ids.includes(String(actorId))&&/^\d+$/.test(String(actorId));
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método inválido'});
 if(!enabled())return res.status(404).json({error:'Não disponível'});
 if(!fixedEqual(req.headers?.['x-telegram-bot-api-secret-token'],process.env.TELEGRAM_WEBHOOK_SECRET))
  return res.status(403).json({error:'Não autorizado'});
 const cb=req.body?.callback_query;if(!cb)return res.status(200).json({ok:true});
 const parsed=parseCallback(cb.data);
 if(!parsed||!authorized(cb.from?.id)||String(cb.message?.chat?.id)!==String(process.env.TELEGRAM_CHAT_ID)){
  try{if(cb.id)await telegramCall('answerCallbackQuery',{callback_query_id:cb.id,text:'Ação não autorizada ou inválida',show_alert:true});}catch{}
  return res.status(200).json({ok:true});
 }
 try{
  const store=initReviewStore(),row=await store.get(parsed.id);
  if(!row||row.status!=='pending_review'||Number(row.telegram_message_id)!==cb.message?.message_id){
   await telegramCall('answerCallbackQuery',{callback_query_id:cb.id,text:'Pedido já analisado ou não localizado',show_alert:true});
   return res.status(200).json({ok:true});
  }
  const markup=parsed.action==='r'?buttonsForRejection(parsed.id):
   parsed.action==='b'?buttonsForOrder(parsed.id):null;
  if(markup){
   await telegramCall('editMessageReplyMarkup',{chat_id:process.env.TELEGRAM_CHAT_ID,message_id:row.telegram_message_id,reply_markup:markup});
   await telegramCall('answerCallbackQuery',{callback_query_id:cb.id,text:parsed.action==='r'?'Escolha o motivo':'Retornou ao pedido'});
   return res.status(200).json({ok:true});
  }
  const approved=parsed.action==='a';
  const decided=await store.decide(parsed.id,approved?'approved':'rejected',Number(cb.from.id),approved?null:parsed.reason,cb.message.message_id);
  if(!decided){
   await telegramCall('answerCallbackQuery',{callback_query_id:cb.id,text:'Pedido já analisado',show_alert:true});
   return res.status(200).json({ok:true});
  }
  // Estado durável gravado ANTES de responder ao Telegram.
  await telegramCall('answerCallbackQuery',{callback_query_id:cb.id,text:approved?'Pedido aprovado':'Pedido rejeitado'});
  const replyMarkup=approved?approvedButtons(row.customer_phone,row.customer_name,row.order_ref):{inline_keyboard:[]};
  await telegramCall('editMessageReplyMarkup',{chat_id:process.env.TELEGRAM_CHAT_ID,message_id:row.telegram_message_id,reply_markup:replyMarkup});
  if(!approved)await telegramCall('sendMessage',{chat_id:process.env.TELEGRAM_CHAT_ID,
   text:'Pré-pedido #'+row.order_ref+' rejeitado. Motivo: '+parsed.reason});
  return res.status(200).json({ok:true});
 }catch{
  // Telegram pode repetir webhook; atualização atômica evita decisões duplas.
  return res.status(503).json({error:'Tente novamente'});
 }
};
