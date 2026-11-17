// Consulta dinâmica do horário; não adota o relógio local para decidir se aceita pedido.
const label = document.getElementById('storeOpenStatus');
const dialog = document.getElementById('storeClosedDialog');
const description = document.getElementById('storeClosedDescription');
const alertNote = document.getElementById('storeAlertNote');
const dismiss = document.getElementById('dismissStoreClosed');
const noticeKey = 'disk-panquecao-closed-notice-v1';
let previousOpen = null;
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
  try {
    const response = await fetch('/api/store-status',{cache:'no-store'});
    const data = await response.json();
    if (!data.enabled) { label.hidden = true; return; }
    label.hidden = false;
    const open = response.ok && data.open === true;
    if (data.unknown || !response.ok) {
      label.textContent = 'Não foi possível confirmar o horário da loja. Pedidos temporariamente indisponíveis.';
    } else if (open) {
      label.textContent = 'Loja aberta • pré-pedidos sujeitos à confirmação';
    } else {
      label.textContent = 'Loja fechada no momento • você pode consultar o cardápio';
    }
    if (open) {
      previousOpen = true;
      try { sessionStorage.removeItem(noticeKey); } catch {}
      if (dialog.open) dialog.close();
      return;
    }
    if (data.unknown || !response.ok) {
      description.textContent = 'Não foi possível confirmar se a loja está aberta. Tente novamente mais tarde.';
    } else {
      description.textContent = 'Estamos fora do horário de atendimento. Você pode navegar pelo cardápio, mas novos pré-pedidos não serão recebidos até a reabertura.';
    }
    alertNote.textContent = data.canSubscribe
      ? 'Você poderá ativar avisos com sua permissão. Nunca habilitamos notificações sem sua escolha.'
      : 'Avisos automáticos de reabertura ainda não estão habilitados. Você pode consultar o status ao voltar ao site.';
    if (previousOpen !== false) noticeOnce(data);
    previousOpen = false;
  } catch {
    label.hidden = false;
    label.textContent = 'Não foi possível verificar o funcionamento. Consulte a loja antes de enviar pedido.';
  }
}
refreshStatus();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStatus();
});
setInterval(() => { if (!document.hidden) refreshStatus(); }, 60000);
