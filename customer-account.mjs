import {accountRequest} from './customer-account-client.mjs';
import {normalizeFulfillment} from './fulfillment.mjs';
const $=id=>document.getElementById(id);
const login=$('accountLogin'),dashboard=$('accountDashboard'),profile=$('profileForm'),address=$('addressForm');
const demo=document.body.dataset.premiumPreview==='true';
$('accountDemoNotice').hidden=!demo;
let config,areas,next=null,records=[],editing=null,email='',working=false,widget=null,challenge='';
const signalSession=kind=>{if(!demo)try{window.localStorage.setItem('dp-account-session-change-v1',kind+':'+Date.now());}catch{}};
const status=msg=>{$('accountStatus').textContent=msg;};
const report=e=>status(e?.message||'Não foi possível concluir. Tente novamente.');
async function busy(task){
 if(working)return;working=true;
 const buttons=[...document.querySelectorAll('button:not(:disabled)')];buttons.forEach(b=>b.disabled=true);
 try{await task();}catch(e){report(e);}finally{working=false;buttons.forEach(b=>b.disabled=false);}
}
function makeButton(text,action){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;b.onclick=()=>busy(action);return b;}
async function getAreas(){
 if(!areas){const r=await fetch('/delivery-areas.json',{cache:'no-cache'});if(!r.ok)throw new Error('Bairros indisponíveis. Tente novamente.');areas=await r.json();}
 return areas;
}
async function neighborhoods(selected=''){
 const city=address.elements.city.value;
 const n=address.elements.neighborhood;n.replaceChildren(new Option(city?'Selecione o bairro':'Selecione a cidade',''));n.disabled=!city;
 if(city){for(const a of (await getAreas()).cities?.[city]||[])n.add(new Option(a.name,a.name));n.add(new Option('Outro bairro/localidade','__other__'));}
 n.value=selected;if(!n.value&&selected){n.value='__other__';address.elements.otherNeighborhood.value=selected;}
 other();
}
function other(){const show=address.elements.neighborhood.value==='__other__';$('otherNeighborhoodWrap').hidden=!show;address.elements.otherNeighborhood.required=show;address.elements.otherNeighborhood.disabled=!show;}
function clearAddress(){editing=null;address.reset();address.hidden=true;void neighborhoods().catch(report);}
async function openAddress(entry){
 editing=entry||null;address.reset();$('addressFormTitle').textContent=entry?'Editar endereço':'Novo endereço';
 if(entry){address.elements.label.value=entry.label;for(const key of ['city','street','number','complement','reference','otherNeighborhood'])address.elements[key].value=entry.data[key]||'';}
 await neighborhoods(entry?.data.neighborhood||'');address.hidden=false;address.elements.label.focus();
}
function render(){
 const root=$('addressList');root.replaceChildren();
 if(!records.length){const p=document.createElement('p');p.textContent='Nenhum endereço cadastrado. Adicione o primeiro!';root.append(p);}
 for(const entry of records){
  const card=document.createElement('article');card.className='address-card';
  const h=document.createElement('h3');h.textContent=entry.label;
  const p=document.createElement('p');const d=entry.data;p.textContent=[d.street+', '+d.number,d.neighborhood==='__other__'?d.otherNeighborhood:d.neighborhood,d.city,d.complement,d.reference].filter(Boolean).join(' · ');
  const actions=document.createElement('div');actions.className='address-actions';
  actions.append(makeButton('Editar',()=>openAddress(entry)),makeButton('Excluir',async()=>{if(!confirm('Excluir o endereço '+entry.label+'?'))return;await accountRequest('address_delete',{id:entry.id,revision:entry.revision});if(editing?.id===entry.id)clearAddress();await loadAddresses();status('Endereço excluído.');}));
  card.append(h,p,actions);root.append(card);
 }
 $('moreAddresses').hidden=!next;
}
async function loadAddresses(more=false){
 const result=await accountRequest('addresses',null,more&&next?{after:next}:{});
 records=more?[...records,...result.addresses]:result.addresses;next=result.next;render();
}
async function showAccount(state){
 login.hidden=true;dashboard.hidden=false;$('accountEmail').textContent=state.email;profile.elements.name.value=state.profile?.name||'';profile.elements.phone.value=state.profile?.phone||'';const cpf=profile.elements.cpf;if(cpf){const required=config?.cpfRequired===true;const linked=state.profile?.hasCpf===true;$('cpfField').hidden=!required;cpf.disabled=!required||linked;cpf.required=required&&!linked;cpf.value='';$('cpfHint').textContent=linked?'CPF vinculado · final '+state.profile.cpfLast2:'Necessário para pedidos de delivery. Não é sua senha.';}clearAddress();await loadAddresses();
}
async function showLogin(){
 dashboard.hidden=true;login.hidden=false;$('otpRequest').hidden=false;$('otpVerify').hidden=true;
 if(demo){$('otpRequest').elements.email.value='cliente@example.test';return;}
 if(!config?.siteKey)throw new Error('Cadastro temporariamente indisponível.');
 if(!window.turnstile){
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=reject;document.head.append(script);});
 }
 if(!window.turnstile)throw new Error('Verificação de segurança indisponível.');
 if(widget===null)widget=window.turnstile.render('#accountTurnstile',{sitekey:config.siteKey,action:'customer_otp',callback:t=>challenge=t,'expired-callback':()=>challenge='','error-callback':()=>challenge=''});
}
$('otpRequest').onsubmit=e=>{e.preventDefault();void busy(async()=>{email=$('otpRequest').elements.email.value.trim().toLowerCase();if(!demo&&!challenge)throw new Error('Conclua a verificação de segurança.');try{await accountRequest('otp_request',{email,challenge:demo?'demo':challenge});}finally{challenge='';if(widget!==null)window.turnstile.reset(widget);}$('otpRequest').hidden=true;$('otpVerify').hidden=false;if(demo)$('otpVerify').elements.otp.value='123456';status(demo?'Código de teste: 123456. Nenhum e-mail enviado.':'Confira sua caixa de entrada.');$('otpVerify').elements.otp.focus();});};
$('otpVerify').onsubmit=e=>{e.preventDefault();void busy(async()=>{const state=await accountRequest('otp_verify',{email,otp:$('otpVerify').elements.otp.value});$('otpVerify').reset();signalSession('login');await showAccount(state);status('Bem-vindo!');});};
$('changeEmail').onclick=()=>busy(async()=>{await showLogin();status('');});
$('accountLogout').onclick=()=>busy(async()=>{await accountRequest('logout',{});signalSession('logout');records=[];next=null;profile.reset();clearAddress();$('accountEmail').textContent='';$('addressList').replaceChildren();await showLogin();status('Você saiu da conta.');});
profile.onsubmit=e=>{e.preventDefault();void busy(async()=>{await accountRequest('profile_save',{name:profile.elements.name.value,phone:profile.elements.phone.value,...(config?.cpfRequired&&profile.elements.cpf&&!profile.elements.cpf.disabled?{cpf:profile.elements.cpf.value}:{})});await showAccount(await accountRequest('state'));status('Seus dados foram salvos.');});};
$('addAddress').onclick=()=>busy(()=>openAddress(null));
$('cancelAddress').onclick=()=>{clearAddress();status('Edição cancelada.');};
$('moreAddresses').onclick=()=>busy(()=>loadAddresses(true));
address.elements.city.onchange=()=>{void neighborhoods().catch(report);};address.elements.neighborhood.onchange=other;
address.onsubmit=e=>{e.preventDefault();void busy(async()=>{const data={};for(const key of ['city','neighborhood','otherNeighborhood','street','number','complement','reference'])data[key]=address.elements[key].value;normalizeFulfillment({...data,type:'delivery'},await getAreas());await accountRequest('address_save',{...(editing?{id:editing.id,revision:editing.revision}:{}),label:address.elements.label.value,address:data});clearAddress();await loadAddresses();status('Endereço salvo.');});};
void busy(async()=>{config=await accountRequest('config');try{await showAccount(await accountRequest('state'));}catch(e){if(e.status!==401)throw e;await showLogin();}});
