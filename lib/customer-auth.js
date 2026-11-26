'use strict';
const crypto=require('node:crypto');
const db=require('./backoffice-neon');
class AccountError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const prefix='__Host-dpc_';
function config(){
 const base=process.env.CUSTOMER_AUTH_BASE_URL?.replace(/\/$/,'');
 const staff=process.env.NEON_AUTH_BASE_URL?.replace(/\/$/,'');
 const origin=process.env.CUSTOMER_ACCOUNT_ORIGIN;
 const key=process.env.CUSTOMER_OTP_HMAC_KEY;
 if(process.env.CUSTOMER_ACCOUNTS_ENABLED!=='true'||!db.configured()||!base||base===staff||!staff||
 !/^https:\/\/[a-z0-9.-]+\/[a-z0-9_./-]+$/i.test(base)||!/^https:\/\/[a-z0-9.-]+$/i.test(origin||'')||
 !/^[a-f0-9]{64}$/i.test(key||'')||!process.env.TURNSTILE_SECRET_KEY||!process.env.TURNSTILE_SITE_KEY)
 throw new AccountError('Cadastro de clientes ainda não habilitado.',503);
 return {base,origin,key};
}
function originGuard(req,cfg,write=true){
 const host=new URL(cfg.origin).host;
 if(String(req.headers?.host||'').toLowerCase()!==host|| (write&&req.headers?.origin!==cfg.origin))
 throw new AccountError('Origem não autorizada.',403);
}
function originalCookie(name){return /^(?:__Secure-|__Host-)?(?:better-auth|neon-auth)[a-z0-9._-]*$/i.test(name);}
function cookiePairs(req){
 const out=[];for(const raw of String(req.headers?.cookie||'').split(';')){
  const pair=raw.trim(),i=pair.indexOf('='),name=pair.slice(0,i),value=pair.slice(i+1);
  if(i<1||!name.startsWith(prefix)||!/^[-a-f0-9]+$/i.test(name.slice(prefix.length))||value.length>3900||/[\r\n;]/.test(value))continue;
  const original=Buffer.from(name.slice(prefix.length),'hex').toString('utf8');
  if(originalCookie(original))out.push({name,original,value});
 }return out;
}
function upstreamCookies(req){return cookiePairs(req).map(x=>x.original+'='+x.value).join('; ');}
function responseCookies(response){
 return (response.headers.getSetCookie?.()||[]).flatMap(raw=>{
  const [pair,...attrs]=raw.split(';'),i=pair.indexOf('='),name=pair.slice(0,i),val=pair.slice(i+1);
  if(i<1||!originalCookie(name)||val.length>3900||/[\r\n;]/.test(val))return [];
  const max=attrs.find(x=>/^\s*max-age=/i.test(x));let ttl=604800;
  if(max){const n=Number(max.split('=')[1]);if(Number.isFinite(n))ttl=Math.max(0,Math.min(604800,n));}
  if(!val)ttl=0;
  return [prefix+Buffer.from(name).toString('hex')+'='+val+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+ttl];
 });
}
async function call(cfg,endpoint,{body,req}={}){
 if(!['get-session','email-otp/send-verification-otp','sign-in/email-otp','sign-out'].includes(endpoint))throw new AccountError('Operação inválida.',403);
 const cookie=req?upstreamCookies(req):'';
 let res;try{res=await fetch(cfg.base+'/'+endpoint,{method:body?'POST':'GET',headers:{Accept:'application/json',Origin:cfg.origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch{throw new AccountError('Serviço de acesso indisponível.',503);}
 let data;try{data=await res.json();}catch{throw new AccountError('Serviço de acesso indisponível.',503);}
 if(!res.ok||data?.error)throw new AccountError(res.status===429?'Muitas tentativas. Aguarde.':endpoint==='sign-in/email-otp'?'Código inválido ou expirado.':'Serviço de acesso indisponível.',res.status===429?429:endpoint==='sign-in/email-otp'?401:503);
 return {data,cookies:responseCookies(res)};
}
function email(value){const s=String(value||'').trim().toLowerCase();if(s.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(s)||s.split('@').length!==2)throw new AccountError('E-mail inválido.');return s;}
function identity(data){const u=data?.user;if(typeof u?.id!=='string'||u.id.length<4||u.id.length>150||u.emailVerified!==true)throw new AccountError('Confirme seu e-mail para entrar.',401);return {subject:u.id,email:email(u.email)};}
async function actor(req,cfg){if(!upstreamCookies(req))throw new AccountError('Entre na sua conta.',401);const r=await call(cfg,'get-session',{req});if(!r.data?.session)throw new AccountError('Sessão expirada.',401);return identity(r.data);}
async function requestOtp(req,cfg,body){
 const address=email(body.email);
 if(typeof body.challenge!=='string'||body.challenge.length<1||body.challenge.length>2048)throw new AccountError('Conclua a verificação de segurança.',403);
 let check;try{const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:body.challenge}),signal:AbortSignal.timeout(6500)});check=await r.json();}catch{throw new AccountError('Verificação indisponível.',503);}
 if(!check.success||check.action!=='customer_otp'||check.hostname!==new URL(cfg.origin).hostname)throw new AccountError('Verificação inválida.',403);
 const hash=crypto.createHmac('sha256',cfg.key).update(address).digest('hex');
 const rows=await db.run("INSERT INTO dp.customer_otp_limits(email_key) VALUES($1) ON CONFLICT(email_key) DO UPDATE SET requested_at=now() WHERE dp.customer_otp_limits.requested_at < now()-interval '90 seconds' RETURNING email_key",[hash]);
 if(!rows.length)throw new AccountError('Aguarde 90 segundos para solicitar outro código.',429);
 await call(cfg,'email-otp/send-verification-otp',{body:{email:address,type:'sign-in'}});
 return {requested:true};
}
async function verifyOtp(req,res,cfg,body){
 const address=email(body.email),otp=String(body.otp||'');
 if(!/^\d{6,8}$/.test(otp))throw new AccountError('Informe o código recebido.');
 const result=await call(cfg,'sign-in/email-otp',{body:{email:address,otp}});
 const who=identity(result.data);
 if(who.email!==address||!result.cookies.some(x=>!x.includes('Max-Age=0')))throw new AccountError('Sessão não confirmada.',503);
 res.setHeader('Set-Cookie',result.cookies);return who;
}
async function logout(req,res,cfg){
 const clear=cookiePairs(req).map(x=>x.name+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
 try{if(clear.length)await call(cfg,'sign-out',{req,body:{}});}finally{if(clear.length)res.setHeader('Set-Cookie',clear);}
 return {signedOut:true};
}
module.exports={AccountError,config,originGuard,actor,requestOtp,verifyOtp,logout,upstreamCookies,responseCookies,identity};
