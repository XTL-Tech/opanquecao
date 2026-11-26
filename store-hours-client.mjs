// Consulta dinâmica do horário; não adota o relógio local para decidir se aceita pedido.
const label = document.getElementById('storeOpenStatus');
const dialog = document.getElementById('storeClosedDialog');
const description = document.getElementById('storeClosedDescription');
const alertNote = document.getElementById('storeAlertNote');
const dismiss = document.getElementById('dismissStoreClosed');
const noticeKey = 'disk-panquecao-closed-notice-v1';
let previousOpen = null;
let refreshing = false;
function publishStatus(detail) {
  window.storeOperationStatus = detail;
  const closed = detail.enabled === true && detail.open !== true;
  document.documentElement.classList.toggle("store-lights-off", closed);
  const lights = document.getElementById("storeLightsStatus");
  if(lights){lights.hidden=!closed;const title=lights.querySelector("strong");if(title)title.textContent=detail.unknown?"● ATENDIMENTO TEMPORARIAMENTE INDISPONÍVEL":"● LUZES APAGADAS";}
  document.dispatchEvent(new CustomEvent('store-operation-status',{detail}));
}
function noticeOnce(status) {
  const key = status.date + ':' + status.reason;
  let seen = false;
  try { seen = sessionStorage.getItem(noticeKey) === key; } catch {}
  if (!seen && !dialog.open && typeof dialog.showModal === 'function') {
    dialog.showModal();
    try { sessionStorage.setItem(noticeKey,key); } catch {}
  }
}
dismiss.addEventListener('click',() => dialog.close());
async function refreshStatus() {
  if(refreshing)return;
  refreshing=true;
  try {
    const response = document.body.dataset.premiumPreview==='true'?{ok:true,json:async()=>({demoAvailable:true})}:await fetch('/api/store-status',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    let data = await response.json();
    const demoMode = new URLSearchParams(window.location.search).get('xtl_demo_loja');
    if (document.body.dataset.premiumPreview==="true" || (data.demoAvailable && ['aberta','fechada'].includes(demoMode))) {
      data = {
        enabled:true, open:demoMode !== 'fechada', reason:'demo_'+(demoMode||'aberta'),
        date:'demonstracao', canSubscribe:false, simulated:true
      };
    }
    if (response.ok && data.enabled === false) {
      label.hidden = true;
      publishStatus({enabled:false,open:true});
      return;
    }
    label.hidden = false;
    const open = (response.ok || data.simulated) && data.enabled === true && data.open === true;
    publishStatus({enabled:true,open,unknown:!!data.unknown,simulated:!!data.simulated});
    if (data.unknown || (!response.ok && !data.simulated)) {
      label.textContent = 'Não foi possível confirmar o horário da loja. Pedidos temporariamente indisponíveis.';
    } else if (open) {
      label.textContent = data.simulated ? 'DEMONSTRAÇÃO: loja aberta (simulada) • envio de pedidos desativado' : 'Loja aberta • pré-pedidos sujeitos à confirmação';
    } else {
      label.textContent = data.simulated ? 'DEMONSTRAÇÃO: loja fechada (simulada) • envio de pedidos desativado' : 'Loja fechada no momento • você pode consultar o cardápio';
    }
    if (open) {
      previousOpen = true;
      try { sessionStorage.removeItem(noticeKey); } catch {}
      if (dialog.open) dialog.close();
      return;
    }
    if (data.unknown || (!response.ok && !data.simulated)) {
      description.textContent = 'Não foi possível confirmar se a loja está aberta. Tente novamente mais tarde.';
    } else {
      description.textContent = data.simulated ? 'TESTE DE INTERFACE: simulamos a loja fechada. Os horários reais não estão configurados. Você pode navegar pelo cardápio, mas não enviar pedidos nesta demonstração.' : 'Estamos fora do horário de atendimento. Você pode navegar pelo cardápio, mas novos pré-pedidos não serão recebidos até a reabertura.';
    }
    alertNote.textContent = data.canSubscribe
      ? 'Você poderá ativar avisos com sua permissão. Nunca habilitamos notificações sem sua escolha.'
      : 'Avisos automáticos de reabertura ainda não estão habilitados. Você pode consultar o status ao voltar ao site.';
    if (previousOpen !== false) noticeOnce(data);
    previousOpen = false;
  } catch {
    publishStatus({enabled:true,open:false,unknown:true});
    label.hidden = false;
    label.textContent = 'Não foi possível verificar o funcionamento. Você pode consultar o cardápio.';
    description.textContent = 'O atendimento está temporariamente indisponível. Você pode continuar conhecendo o cardápio.';
    alertNote.textContent = 'Consulte o status novamente mais tarde.';
    if(previousOpen !== false)noticeOnce({date:"unknown",reason:"unavailable"});
    previousOpen=false;
  } finally { refreshing=false; }
}
publishStatus({enabled:true,open:false,unknown:true});
refreshStatus();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStatus();
});
setInterval(() => { if (!document.hidden) refreshStatus(); }, 60000);
