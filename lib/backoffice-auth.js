'use strict';
const db=require('./backoffice-data');
const c=require('./backoffice-core');
const ACCESS='__Host-dp_access',REFRESH='__Host-dp_refresh';
class AuthError extends Error{constructor(message,status=401){super(message);this.status=status;}}
function originGuard(req){
 const raw=req.headers?.origin;
 const host=req.headers?.host?.toLowerCase();
 if(!host||typeof raw!=='string')throw new AuthError('Origem da operação não verificada.',403);
 let url;
 try{url=new URL(raw);}catch{throw new AuthError('Origem inválida.',403);}
 if(url.protocol!=='https:'||url.host.toLowerCase()!==host)
   throw new AuthError('Operação bloqueada por proteção de origem.',403);
}
function cookie(req,name) {
 const match=String(req.headers?.cookie||'').split(';').map(x=>x.trim())
   .find(x=>x.startsWith(name+'='));
 const token=match?.slice(name.length+1);
 return token&&/^[a-zA-Z0-9._~-]+$/.test(token)?token:null;
}
function setCookies(res,data){
 if(!data?.access_token||!data?.refresh_token)throw new AuthError('Sessão inválida.');
 const ttl=Math.max(1,Math.min(3600,Number(data.expires_in)||3600));
 res.setHeader('Set-Cookie',[
  ACCESS+'='+data.access_token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+ttl,
  REFRESH+'='+data.refresh_token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800'
 ]);
}
function clearCookies(res){
 res.setHeader('Set-Cookie',[
  ACCESS+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
  REFRESH+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'
 ]);
}
async function authRequest(path,token,body){
 const {url,publicKey}=db.config();
 let result;
 try{
  result=await fetch(url+'/auth/v1/'+path,{
   method:body?'POST':'GET',cache:'no-store',
   headers:{apikey:publicKey,Accept:'application/json',
    ...(token?{Authorization:'Bearer '+token}:{}),
    ...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),
   signal:AbortSignal.timeout(7000)
  });
 }catch{throw new AuthError('Autenticação indisponível.',503);}
 if(!result.ok)throw new AuthError(result.status===429?'Muitas tentativas; tente mais tarde.':'Credenciais ou sessão inválidas.',result.status===429?429:401);
 const data=await result.json();
 return data;
}
async function staffFor(user){
 if(!c.UUID.test(user?.id))throw new AuthError('Sessão inválida.');
 const rows=await db.query('restaurant_staff',{filter:{
  restaurant_id:'eq.'+c.RESTAURANT,user_id:'eq.'+user.id,active:'eq.true',
  select:'user_id,role,active',limit:1
 }});
 if(!['manager','attendant'].includes(rows?.[0]?.role))
   throw new AuthError('Conta sem autorização para o Disk Panquecão.',403);
 return {id:user.id,role:rows[0].role,email:user.email||'',name:user.email?.split('@')[0]||'Atendente'};
}
async function login(req,res,body){
 const email=String(body?.email||'').trim().toLowerCase(),password=body?.password;
 if(email.length>254||!email.includes('@')||typeof password!=='string'||password.length<8||password.length>256)
  throw new AuthError('Informe um e-mail e uma senha válidos.',400);
 const tokens=await authRequest('token?grant_type=password',null,{email,password});
 const user=await authRequest('user',tokens.access_token);
 const actor=await staffFor(user); // sem staff autorizado = sem cookie
 setCookies(res,tokens);
 return actor;
}
async function actor(req,res){
 let token=cookie(req,ACCESS);
 if(!token)throw new AuthError('Faça login para continuar.');
 let user;
 try{user=await authRequest('user',token);}
 catch(err){
  if(err.status!==401)throw err;
  const refresh=cookie(req,REFRESH);
  if(!refresh)throw err;
  const tokens=await authRequest('token?grant_type=refresh_token',null,{refresh_token:refresh});
  user=await authRequest('user',tokens.access_token);
  const a=await staffFor(user);
  setCookies(res,tokens);
  return a;
 }
 return staffFor(user);
}
module.exports={AuthError,originGuard,cookie,login,actor,clearCookies};
