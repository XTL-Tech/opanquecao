'use strict';
const $=id=>document.getElementById(id);
let ads=[],cursor=0,timer,refreshing=false,lastOK=0,validUntil=0;
const active=()=>Date.now()<validUntil?ads.filter(a=>a.tv===true&&Date.parse(a.expiresAt)>Date.now()):[];
function fallback(){
 $('art').hidden=true;$('art').removeAttribute('src');$('copy').hidden=false;
 $('sponsor').textContent='DISK PANQUECÃO';$('headline').textContent='Obrigado pela preferência!';$('description').textContent='Feito com carinho para você.';
}
function play(){
 clearTimeout(timer);
 const queue=active();
 if(!queue.length){fallback();timer=setTimeout(play,5000);return;}
 const a=queue[cursor++%queue.length];
 $('sponsor').textContent=a.name;$('headline').textContent=a.headline;$('description').textContent=a.description;
 $('copy').hidden=false;$('art').hidden=true;$('art').removeAttribute('src');
 if(/^\/img\/parceiros\/[a-z0-9_-]+\.(webp|png|jpg)$/i.test(a.media||'')){
  const img=$('art'),src=a.media;
  img.onload=()=>{if(img.getAttribute('src')===src){img.hidden=false;$('copy').hidden=true;}};
  img.onerror=()=>{img.hidden=true;$('copy').hidden=false;};img.src=src;
 }
 $('stage').classList.remove('enter');void $('stage').offsetWidth;$('stage').classList.add('enter');
 timer=setTimeout(play,Math.min(Math.max(5,Math.min(60,Number(a.seconds)||15))*1000,Math.max(100,Date.parse(a.expiresAt)-Date.now()),Math.max(100,validUntil-Date.now())));
}
async function refresh(){
 if(refreshing||document.hidden)return;refreshing=true;
 try{
  const r=await fetch('/api/backoffice?action=ad_playlist',{credentials:'omit',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('unavailable');const d=await r.json();
  if(!Array.isArray(d.ads)||!Number.isFinite(Date.parse(d.generatedAt)))throw Error('invalid');
  const changed=JSON.stringify(ads)!==JSON.stringify(d.ads);
  const wasExpired=Date.now()>=validUntil;
  ads=d.ads;lastOK=Date.now();validUntil=Date.parse(d.generatedAt)+180000;
  $('status').textContent='Programação atualizada '+new Date(lastOK).toLocaleTimeString('pt-BR');
  if(changed||wasExpired||!timer){cursor=0;play();}
 }catch{ $('status').textContent='Conexão instável · programação temporária';if(!active().length)play(); }
 finally{refreshing=false;}
}
$('fullscreen').onclick=()=>{if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
setInterval(refresh,60000);void refresh();
