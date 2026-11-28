'use strict';
// Neon Managed Auth (Better Auth): upstream valida sessão e senha.
// Não armazenar senhas/tokens em PostgreSQL próprio nem expor token em JS.
const db=require('./backoffice-neon');
class AuthError extends Error {constructor(message,status=401){super(message);this.status=status;}}
const configured=()=>/^https:\/\/[a-z0-9.-]+\/.+/i.test(process.env.NEON_AUTH_BASE_URL||'');
function originGuard(req){
 const host=req.headers?.host?.toLowerCase(),origin=req.headers?.origin;
 if(!host||!origin)throw new AuthError('Origem da operação não verificada.',403);
 let u;try{u=new URL(origin);}catch{throw new AuthError('Origem inválida.',403);}
 if(u.protocol!=='https:'||u.host.toLowerCase()!==host)
  throw new AuthError('Operação bloqueada por proteção de origem.',403);
}
function authCookie(raw){
 return String(raw||'').split(';').map(x=>x.trim()).filter(x=>{
  const name=x.split('=',1)[0];
  return /^(?:__Secure-|__Host-)?(?:better-auth|neon-auth)[a-z0-9._-]*$/i.test(name)&&x.length<4096;
 }).join('; ');
}
function responseCookies(response){
 const cookies=typeof response.headers.getSetCookie==='function'?
  response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);
 return cookies.map(x=>{
  const [pair,...attrs]=x.split(';');const name=pair.split('=',1)[0];
  if(!/^(?:__Secure-|__Host-)?(?:better-auth|neon-auth)[a-z0-9._-]*$/i.test(name)||!/^[-_.a-z0-9]+=[^;\r\n]*$/i.test(pair))return null;
  let maxAge=attrs.find(x=>/^\s*max-age=\d+/i.test(x))?.trim();
  if(maxAge&&Number(maxAge.split('=')[1])>604800)maxAge='Max-Age=604800';
  // Não confiar em Domain/Path/SameSite vindos do host da Neon.
  return pair+'; Path=/; Secure; HttpOnly; SameSite=Strict'+(maxAge?'; '+maxAge:'');
 }).filter(Boolean);
}
async function requestAuth(endpoint,{method='GET',body,cookie}={}){
 const base=process.env.NEON_AUTH_BASE_URL;
 if(!configured()||!db.configured())throw new AuthError('Autenticação ainda não habilitada.',503);
 if(!['get-session','sign-in/email','sign-out','email-otp/send-verification-otp','sign-in/email-otp'].includes(endpoint))throw new AuthError('Operação não autorizada.',403);
 const headers={Accept:'application/json',
  Origin:'https://opanquecao.vercel.app',
  ...(body?{'Content-Type':'application/json'}:{})};
 const cookies=authCookie(cookie);
 if(cookies)headers.Cookie=cookies;
 let response;
 try{
  response=await fetch(base.replace(/\/$/,'')+'/'+endpoint,{
   method,headers,cache:'no-store',
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7500)
  });
 }catch{throw new AuthError('Serviço de autenticação indisponível.',503);}
 let data;try{data=await response.json();}catch{throw new AuthError('Resposta inválida de autenticação.',503);}
 if(!response.ok||data?.error){
  if(endpoint==='email-otp/send-verification-otp'){
   const providerCode=String(data?.code||data?.error?.code||'UNSPECIFIED')
    .replace(/[^A-Za-z0-9_]/g,'').slice(0,64);
   console.warn(JSON.stringify({event:'otp_provider_rejected',
    upstreamStatus:response.status,providerCode}));
  }
  throw new AuthError(response.status===429?'Muitas tentativas. Tente mais tarde.':
   endpoint==='email-otp/send-verification-otp'?
    'Não foi possível gerar o código de acesso. O serviço de autenticação recusou a solicitação.':
    'Credenciais inválidas ou sessão expirada.',
   response.status===429?429:endpoint==='email-otp/send-verification-otp'?503:401);
 }
 return {data,cookies:responseCookies(response)};
}
async function staffFor(user){
 if(typeof user?.id!=='string'||user.id.length<4||user.id.length>150)
  throw new AuthError('Sessão inválida.');
 const staff=await db.staff(user.id);
 if(!staff||!staff.active||!['admin','manager','attendant','kitchen','courier'].includes(staff.role))
  throw new AuthError('Usuário não autorizado para este restaurante.',403);
 if((process.env.LITE_ADMIN_ENABLED==='true'||process.env.DIGITAL_ORDERS_ENABLED==='true')&&!['admin','manager'].includes(staff.role))throw new AuthError('Acesso restrito à administração.',403);
 if(staff.role==='admin'&&(String(user.email||'').toLowerCase()!=='opedrososamuel@gmail.com'||String(staff.email||'').toLowerCase()!=='opedrososamuel@gmail.com'))throw new AuthError('Superadmin não autorizado.',403);
 return{id:user.id,role:staff.role,email:typeof user.email==='string'?user.email:'',name:user.name||'Atendente'};
}
async function login(req,res,body){
 const email=String(body?.email||'').trim().toLowerCase(),password=body?.password;
 if(email.length>254||email.length<5||!email.includes('@')||typeof password!=='string'||password.length<8||password.length>256)
  throw new AuthError('Informe e-mail e senha válidos.',400);
 const result=await requestAuth('sign-in/email',{method:'POST',body:{email,password}});
 const actor=await staffFor(result.data?.user);
 if(!result.cookies.length)throw new AuthError('Sessão não recebida do provedor.',503);
 res.setHeader('Set-Cookie',result.cookies);
 return actor;
}
// Nunca expõe a lista de colaboradores. Um único código é permitido a cada 90 s.
async function requestOtp(body){
 const email=String(body?.email||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)
  throw new AuthError('E-mail inválido.',400);
 const claimed=await db.claimStaffOtp(email);
 if(!claimed)return {requested:true};
 try{
  await requestAuth('email-otp/send-verification-otp',{
   method:'POST',body:{email,type:'sign-in'}
  });
 }catch(err){
  try{await db.releaseStaffOtp(email);}catch{
   console.warn(JSON.stringify({event:'otp_throttle_release_failed'}));
  }
  throw err;
 }
 return {requested:true};
}
async function loginOtp(req,res,body){
 const email=String(body?.email||'').trim().toLowerCase();
 const otp=String(body?.otp||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||
  !/^\d{6,8}$/.test(otp))
  throw new AuthError('Informe e-mail e código de acesso válidos.',400);
 const result=await requestAuth('sign-in/email-otp',{method:'POST',body:{email,otp}});
 const staff=await staffFor(result.data?.user);
 if(!result.cookies.length)throw new AuthError('Sessão não recebida do provedor.',503);
 res.setHeader('Set-Cookie',result.cookies);
 return staff;
}
async function actor(req){
 const cookie=req.headers?.cookie;
 if(!authCookie(cookie))throw new AuthError('Faça login para continuar.');
 const result=await requestAuth('get-session',{cookie});
 if(!result.data?.session||!result.data?.user)throw new AuthError('Sessão expirada.');
 return staffFor(result.data.user);
}
async function logout(req,res){
 try{if(authCookie(req.headers?.cookie))await requestAuth('sign-out',{method:'POST',body:{},cookie:req.headers.cookie});}
 catch{/* Ainda assim expirar os cookies locais. */}
 const all=authCookie(req.headers?.cookie).split(';').map(x=>x.trim()).filter(Boolean);
 if(all.length)res.setHeader('Set-Cookie',all.map(x=>x.split('=',1)[0]+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'));
}
module.exports={AuthError,configured,originGuard,authCookie,responseCookies,staffFor,login,requestOtp,loginOtp,actor,logout};
