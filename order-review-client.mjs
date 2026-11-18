'use strict';
// Este módulo apenas consulta o status do pedido no servidor. Não é Web Push.
const key='disk-panquecao-review-session-v1';
const box=document.getElementById('reviewStatusPanel');
const headline=document.getElementById('reviewHeadline');
const detail=document.getElementById('reviewDescription');
let active=null,timer=null,querying=false;
function restore(){
 try{
  const value=JSON.parse(sessionStorage.getItem(key)||'null');
  if(value?.requestId&&value?.trackingToken&&Date.now()-value.savedAt<24*60*60*1000)return value;
 }catch{}return null;
}
function render(status,reason){
 if(!active||!box)return;
 box.hidden=false;
 headline.textContent={
  pending_review:'Pré-pedido #'+active.id+' aguardando aprovação da loja',
  approved:'Pedido #'+active.id+' APROVADO pela loja',
  rejected:'Pedido #'+active.id+' REJEITADO pela loja',
  delivery_uncertain:'Pedido #'+active.id+' requer conferência manual'
 }[status]||'Acompanhando pré-pedido #'+active.id;
 detail.textContent=status==='rejected'?'Motivo informado pela loja: '+(reason||'Consulte o atendimento'):
  status==='approved'?'Seu pré-pedido foi aprovado. A loja pode entrar em contato para confirmar os detalhes.':
  status==='delivery_uncertain'?'Não foi possível confirmar o recebimento. Não reenvie automaticamente. Fale com a loja.':
  'Pedido recebido para análise. Aguarde a decisão da loja. Nenhuma cobrança foi feita.';
 box.style.borderColor=status==='approved'?'#1a7147':status==='rejected'?'#ad2841':'#cba861';
 box.setAttribute('role',status==='rejected'?'alert':'status');
 if(status==='approved'||status==='rejected'||status==='delivery_uncertain')stop();
}
function stop(){if(timer)clearInterval(timer);timer=null;}
async function refresh(){
 if(!active||querying||document.hidden)return;
 querying=true;
 try{
  const response=await fetch('/api/order-status',{method:'POST',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({requestId:active.requestId,token:active.trackingToken})});
  if(response.status===404){render('delivery_uncertain');return;}
  if(!response.ok)return;
  const data=await response.json();
  if(!['pending_review','approved','rejected','delivery_uncertain'].includes(data.status))return;
  render(data.status,data.reason);
 }catch{}finally{querying=false;}
}
function start(value){
 if(!value||typeof value.requestId!=='string'||typeof value.trackingToken!=='string')return;
 active={requestId:value.requestId,trackingToken:value.trackingToken,id:value.id||'—',savedAt:Date.now()};
 try{sessionStorage.setItem(key,JSON.stringify(active));}catch{}
 render('pending_review');
 stop();refresh();
 timer=setInterval(refresh,8000);
}
document.addEventListener('order-review-created',event=>start(event.detail));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
const initial=restore();if(initial)start(initial);
