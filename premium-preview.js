'use strict';
const demoClosed=new URLSearchParams(location.search).get('xtl_demo_loja')==='fechada';
const openLink=document.getElementById('previewOpen'), closedLink=document.getElementById('previewClosed');
(demoClosed?closedLink:openLink).setAttribute('aria-current','page');
function adjust(){
 const closed=document.documentElement.classList.contains('store-lights-off');
 document.getElementById('premiumTitle').textContent=closed?'As luzes se apagaram. Por enquanto.':'Sua fome merece uma experiência.';
 document.getElementById('premiumHeroText').textContent=closed?'Nossa cozinha está descansando. Conheça nossas especialidades enquanto não reabrimos.':'Recheios generosos, sabores marcantes e o prazer de estar à mesa.';
 document.getElementById('premiumCta').textContent=closed?'Conhecer cardápio ↓':'Explorar cardápio ↓';
}
document.addEventListener('store-operation-status',adjust);adjust();
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a&&(/^(tel:|https:\/\/wa\.me\/)/i.test(a.href))){e.preventDefault();alert('Prévia visual: o contato com a loja está desativado.');}},true);
const checkout=document.getElementById('checkout');if(checkout){checkout.noValidate=true;document.getElementById('sendOrder').textContent='Simular conclusão do pedido';const note=document.createElement('p');note.className='delivery-fee-note';note.textContent='Demonstração: use dados fictícios. Nenhuma mensagem, pedido ou pagamento será enviado.';checkout.prepend(note);}
