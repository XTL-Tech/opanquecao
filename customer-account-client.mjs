// Only the isolated premium demo uses synthetic sessionStorage. Live accounts use HttpOnly server sessions.
const demoKey='dp-premium-customer-demo-v1';
const isDemo=()=>document.body?.dataset.premiumPreview==='true';
const sample=()=>({email:'cliente@example.test',profile:{name:'Cliente de demonstração',phone:'51999999999'},addresses:[
 {id:'11111111-1111-4111-8111-111111111111',revision:1,label:'Casa',data:{city:'Nova Hartz',neighborhood:'Centro',street:'Rua de Teste',number:'100',complement:'',reference:''}},
 {id:'22222222-2222-4222-8222-222222222222',revision:1,label:'Trabalho',data:{city:'Araricá',neighborhood:'__other__',otherNeighborhood:'Bairro fictício',street:'Avenida de Teste',number:'200',complement:'',reference:''}}
]});
function read(){try{return JSON.parse(sessionStorage.getItem(demoKey)||'null');}catch{return null;}}
function save(x){sessionStorage.setItem(demoKey,JSON.stringify(x));}
function error(message,status){return Object.assign(new Error(message),{status});}
async function demo(action,body){
 if(action==='config')return {enabled:true,demo:true};
 if(action==='otp_request')return {requested:true};
 if(action==='otp_verify'){if(body.otp!=='123456')throw error('Código de demonstração inválido.',401);const x=sample();save(x);return {email:x.email,profile:x.profile};}
 if(action==='logout'){sessionStorage.removeItem(demoKey);return{signedOut:true};}
 const x=read();if(!x)throw error('Entre na sua conta.',401);
 if(action==='state')return{email:x.email,profile:x.profile};
 if(action==='addresses')return{addresses:x.addresses,next:null};
 if(action==='profile_save'){x.profile={name:body.name,phone:body.phone};save(x);return{profile:x.profile};}
 if(action==='address_save'){
  const old=x.addresses.find(y=>y.id===body.id);
  if(body.id&&(!old||old.revision!==body.revision))throw error('Atualize a lista.',409);
  const address={id:old?.id||crypto.randomUUID(),label:body.label,data:body.address,revision:(old?.revision||0)+1};
  x.addresses=old?x.addresses.map(y=>y.id===old.id?address:y):[...x.addresses,address];save(x);return{address};
 }
 if(action==='address_delete'){x.addresses=x.addresses.filter(y=>y.id!==body.id);save(x);return{removed:true};}
 throw error('Operação inválida.',400);
}
export async function accountRequest(action,body=null,params={}){
 if(isDemo())return demo(action,body||{});
 const query=new URLSearchParams({action,...params});
 const response=await fetch('/api/customer-account?'+query,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify({...body,action})}:{}),signal:AbortSignal.timeout(15000)});
 let result;try{result=await response.json();}catch{throw error('Serviço temporariamente indisponível.',503);}
 if(!response.ok)throw error(result.error||'Não foi possível concluir.',response.status);
 return result;
}
