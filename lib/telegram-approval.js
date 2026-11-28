'use strict';
// Authorization is explicit: Telegram ID -> active dp.staff user_id.
const {timingSafeEqual}=require('node:crypto');
const db=require('../lib/backoffice-neon');
const core=require('../lib/backoffice-core');
const allowedRole=new Set(['admin','manager','attendant']);
function config(){
 const secret=process.env.TELEGRAM_APPROVAL_WEBHOOK_SECRET||'';
 const chat=process.env.TELEGRAM_CHAT_ID||'';
 const token=process.env.TELEGRAM_BOT_TOKEN||'';
 let users;
 try{users=JSON.parse(process.env.TELEGRAM_APPROVAL_USERS||'{}');}catch{return null;}
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(secret)||!chat||!token||
    !users||Array.isArray(users)||typeof users!=='object'||!Object.keys(users).length||
    Object.entries(users).some(([k,v])=>!/^\d{1,20}$/.test(k)||typeof v!=='string'||!core.UUID.test(v)))return null;
 return{secret,chat,token,users};
}
function same(a,b){
 if(typeof a!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
async function telegram(c,method,body){
 const r=await fetch('https://api.telegram.org/bot'+c.token+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)
 });
 const data=await r.json();
 if(!r.ok||data.ok!==true)throw Error('telegram');
}
function approvalEnabled(){return process.env.VERCEL_ENV==='production'&&process.env.TELEGRAM_APPROVAL_ENABLED==='true'&&!!config()&&db.configured();}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método inválido'});
 const c=config();
 if(!c||!approvalEnabled())return res.status(503).json({error:'Aprovação desabilitada'});
 if(!same(req.headers?.['x-telegram-bot-api-secret-token'],c.secret))return res.status(403).json({error:'Origem não autorizada'});
 const q=req.body?.callback_query;
 if(!q||typeof q.id!=='string'||q.id.length>128)return res.status(200).json({ok:true});
 const answer=async(text)=>{try{await telegram(c,'answerCallbackQuery',{callback_query_id:q.id,text,show_alert:true});}catch{/* A confirmação do banco continua sendo a fonte de verdade. */}};
 const match=typeof q.data==='string'?/^(accept|reject):(.+)$/.exec(q.data):null;
 const id=match?.[2]||'',reject=match?.[1]==='reject';
 const digital=require('./digital-orders').enabled();
 if((reject&&!digital)||!core.UUID.test(id)||String(q.message?.chat?.id)!==c.chat||!Number.isSafeInteger(q.message?.message_id)){
  await answer('Operação não autorizada.');return res.status(200).json({ok:true});
 }
 const telegramId=String(q.from?.id||'');
 const actorId=Object.hasOwn(c.users,telegramId)?c.users[telegramId]:null;
 try{
  const staff=actorId?await db.staff(actorId):null;
  if(!staff?.active||!allowedRole.has(staff.role)||(digital&&!['admin','manager'].includes(staff.role))){await answer('Usuário não autorizado.');return res.status(200).json({ok:true});}
  // O clique confirma explicitamente cliente e loja. Uma única atualização
  // condicional impede reaceitar, reabrir ou aceitar pedido com frete pendente.
  if(reject){
   const rows=await db.run("UPDATE dp.orders SET status='cancelled',updated_by=$2,updated_at=now() WHERE request_id=$1 AND origin='site' AND telegram_state='sent' AND status IN ('pending_customer','awaiting_acceptance') AND payment_status='pending' AND EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active=true AND role IN ('admin','manager')) RETURNING request_id",[id,actorId]);
   await answer(rows.length===1?'Pedido rejeitado.':'Pedido indisponível para rejeição. Consulte o painel.');
   if(rows.length===1)try{await telegram(c,'editMessageText',{chat_id:c.chat,message_id:q.message.message_id,text:'PEDIDO REJEITADO\n'+String(q.message.text||'#'+id.slice(0,8)).slice(0,3900),reply_markup:{inline_keyboard:[]}});}catch{}
   return res.status(200).json({ok:true});
  }
  const rows=await db.run(
   "UPDATE dp.orders SET status='accepted',accepted_at=now(),updated_by=$2,updated_at=now() "+
   "WHERE request_id=$1 AND origin='site' AND telegram_state='sent' "+
   "AND status IN ('pending_customer','awaiting_acceptance') "+
   "AND (fulfillment->>'type'<>'delivery' OR delivery_fee_cents IS NOT NULL) "+
   "AND EXISTS(SELECT 1 FROM dp.staff WHERE user_id=$2 AND active=true AND role IN ('admin','manager'"+(digital?"":",'attendant'")+")) RETURNING request_id,status",
   [id,actorId]);
  if(rows.length!==1){
   const order=await db.getOrder(id);
   await answer(order?.status==='accepted'?'Pedido já aceito.':
    order?.fulfillment?.type==='delivery'&&order.delivery_fee_cents===null?
     'Defina o frete no painel antes de aprovar.':'Pedido indisponível para aceite. Consulte o painel.');
   return res.status(200).json({ok:true});
  }
  await answer('Pedido aceito pela loja. Liberado para produção.');
  // Atualiza a legenda, não o PDF original. Remover o botão de aceite.
  const old=q.message.reply_markup?.inline_keyboard;
  const link=Array.isArray(old)?old.flat().find(b=>typeof b?.url==='string'&&/^https:\/\/wa\.me\/55\d{10,11}\?text=/.test(b.url)):null;
  if(typeof q.message.text==='string'){try{await telegram(c,'editMessageText',{chat_id:c.chat,message_id:q.message.message_id,text:'PEDIDO ACEITO\n'+q.message.text.slice(0,3900),reply_markup:{inline_keyboard:link?[[{text:'Contato WhatsApp',url:link.url}]]:[]}});}catch{}return res.status(200).json({ok:true});}
  try{await telegram(c,'editMessageCaption',{chat_id:c.chat,message_id:q.message.message_id,
   caption:'✅ PEDIDO ACEITO PELA LOJA\nLiberado para produção.',
   reply_markup:{inline_keyboard:link?[[{text:'💬 Confirmar pedido com cliente',url:link.url}]]:[]}});}catch{/* Banco aceito mesmo se a edição visual falhar. */}
  return res.status(200).json({ok:true});
 }catch{
  await answer('Não foi possível confirmar o aceite. Consulte o painel.');
  return res.status(503).json({error:'Aceite não confirmado'});
 }
}
module.exports={handler,approvalEnabled};
