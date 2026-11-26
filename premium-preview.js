'use strict';
const demoClosed=new URLSearchParams(location.search).get('xtl_demo_loja')==='fechada';
const openLink=document.getElementById('previewOpen'),closedLink=document.getElementById('previewClosed');
(demoClosed?closedLink:openLink).setAttribute('aria-current','page');
const slides=[
 {title:'Sua fome merece uma experiência.',description:'Recheios generosos, sabores marcantes e o prazer de estar à mesa.',image:'/img/cardapio/c02-p15.webp',alt:'Imagem ilustrativa da especialidade Panquetudo',category:'panquecas-salgadas',cta:'Explorar cardápio'},
 {title:'Um final irresistivelmente doce.',description:'Chocolate, frutas e sabores para transformar o fim da refeição.',image:'/img/cardapio/c03-p08.webp',alt:'Imagem ilustrativa de panqueca de chocolate e morango',category:'panquecas-doces',cta:'Conhecer as doces'},
 {title:'Melhor quando compartilhado.',description:'Porções de frango crocante para aproveitar a mesa em boa companhia.',image:'/img/cardapio/c06-p03.webp',alt:'Imagem ilustrativa de frango crocante e batatas fritas',category:'frango-frito-crocrante-no-pote',cta:'Ver porções'},
 {title:'Refresque seu momento.',description:'Escolha seu açaí e descubra as combinações do cardápio.',image:'/img/cardapio/c01-p01.webp',alt:'Imagem ilustrativa de açaí Panquecão',category:'acai',cta:'Ver açaí'}
];
const hero=document.querySelector('.premium-hero'),media=hero.querySelector('.premium-hero-media img'),dots=document.getElementById('heroDots'),pause=document.getElementById('heroPause'),controls=hero.querySelector('.hero-controls');
let index=0,timer=null,paused=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true,hover=false,focus=false;
const isClosed=()=>demoClosed||document.documentElement.classList.contains('store-lights-off');
function stop(){if(timer!==null)clearTimeout(timer);timer=null;}
function schedule(){stop();if(!paused&&!hover&&!focus&&!document.hidden&&!isClosed())timer=setTimeout(()=>{render(index+1);schedule();},6000);}
function render(next=index){
 index=(next+slides.length)%slides.length;const slide=slides[index],closed=isClosed();
 if(media.getAttribute('src')!==slide.image)media.src=slide.image;media.alt=slide.alt;
 document.getElementById('premiumTitle').textContent=closed?'As luzes se apagaram. Por enquanto.':slide.title;
 document.getElementById('premiumHeroText').textContent=closed?'Nossa cozinha está descansando. Conheça nossas especialidades enquanto não reabrimos.':slide.description;
 const cta=document.getElementById('premiumCta');cta.textContent=(closed?'Conhecer cardápio':slide.cta)+' ↓';cta.href=closed?'#cardapio':'#'+slide.category;
 controls.hidden=closed;
 [...dots.children].forEach((b,i)=>b.setAttribute('aria-current',String(i===index)));
 pause.textContent=paused?'Reproduzir':'Pausar';pause.setAttribute('aria-label',paused?'Retomar rotação':'Pausar rotação');
}
slides.forEach((slide,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Banner '+(i+1)+': '+slide.title);b.addEventListener('click',()=>{render(i);schedule();});dots.append(b);});
document.getElementById('heroPrev').addEventListener('click',()=>{render(index-1);schedule();});
document.getElementById('heroNext').addEventListener('click',()=>{render(index+1);schedule();});
pause.addEventListener('click',()=>{paused=!paused;render();schedule();});
hero.addEventListener('mouseenter',()=>{hover=true;stop();});hero.addEventListener('mouseleave',()=>{hover=false;schedule();});
hero.addEventListener('focusin',()=>{focus=true;stop();});hero.addEventListener('focusout',e=>{if(!hero.contains(e.relatedTarget)){focus=false;schedule();}});
document.addEventListener('visibilitychange',schedule);
document.addEventListener('store-operation-status',()=>{render();schedule();});
render();schedule();
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a&&(/^(tel:|https:\/\/wa\.me\/)/i.test(a.href))){e.preventDefault();alert('Prévia visual: o contato com a loja está desativado.');}},true);
const checkout=document.getElementById('checkout');if(checkout){checkout.noValidate=true;document.getElementById('sendOrder').textContent='Simular conclusão do pedido';const note=document.createElement('p');note.className='delivery-fee-note';note.textContent='Demonstração: use dados fictícios. Nenhuma mensagem, pedido ou pagamento será enviado.';checkout.prepend(note);}
