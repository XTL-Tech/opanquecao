'use strict';
const slides=[
 {title:'MAIS QUE UMA PANQUECA, É O PANQUECÃO',description:'Você merece o melhor. E sua família também.',image:'/img/cardapio/c02-p15.webp',alt:'Imagem ilustrativa da especialidade Panquetudo',category:'panquecas-salgadas',cta:'Explorar cardápio'},
 {title:'A felicidade tem sabor.',description:'Chocolate, frutas e sabores para transformar o fim da refeição.',image:'/img/cardapio/c03-p08.webp',alt:'Imagem ilustrativa de panqueca de chocolate e morango',category:'panquecas-doces',cta:'Conhecer as doces'},
 {title:'O sabor da família.',description:'Compartilhe sabores. Crie memórias. Tudo fica melhor em boa companhia.',image:'/img/cardapio/c06-p03.webp',alt:'Imagem ilustrativa de frango crocante e batatas fritas',category:'frango-frito-crocrante-no-pote',cta:'Ver porções'},
 {title:'Tem momentos que pedem Panquecão.',description:'Depois de um dia em Nova Hartz, descubra seu próximo sabor favorito.',image:'/img/cardapio/c01-p01.webp',alt:'Imagem ilustrativa de açaí Panquecão',category:'acai',cta:'Ver açaí'}
];
const hero=document.querySelector('.premium-hero'),media=hero.querySelector('.premium-hero-media img'),dots=document.getElementById('heroDots'),pause=document.getElementById('heroPause'),controls=hero.querySelector('.hero-controls');
let index=0,timer=null,paused=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true,hover=false,focus=false;
const isClosed=()=>document.documentElement.classList.contains('store-lights-off');
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
