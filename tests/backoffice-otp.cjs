'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const backoffice=require('../api/backoffice');
const original={staff:db.staff,claim:db.claimStaffOtp,release:db.releaseStaffOtp,fetch:global.fetch};
const keys=['DATABASE_URL','BACKOFFICE_ENABLED','BACKOFFICE_PROVIDER','NEON_AUTH_BASE_URL'];
const oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
Object.assign(process.env,{
 DATABASE_URL:'postgresql://test:fake@ep-test.neon.tech/neondb',
 BACKOFFICE_ENABLED:'true',BACKOFFICE_PROVIDER:'neon',
 NEON_AUTH_BASE_URL:'https://ep-test.neonauth.test/neondb/auth'
});
const identity={id:'user-backoffice-otp-manager-1',name:'Gestor',email:'gestor@exemplo.invalid'};
db.staff=async id=>id===identity.id?{user_id:id,email:identity.email,role:'manager',active:true}:null;
let claimCount=0,providerCalls=[],authorized=true,otpCorrect=true,releaseCount=0;
db.releaseStaffOtp=async()=>{releaseCount++;};
db.claimStaffOtp=async email=>{claimCount++;return authorized&&claimCount===1&&email===identity.email;};
global.fetch=async(url,opts)=>{
 const path=String(url).split('/').at(-1);
 providerCalls.push({url:String(url),method:opts.method,body:JSON.parse(opts.body||'{}')});
 if(path==='send-verification-otp'){
  assert.equal(opts.method,'POST');
  assert.deepEqual(JSON.parse(opts.body),{email:identity.email,type:'sign-in'});
  return {ok:true,status:200,headers:new Headers(),json:async()=>({success:true})};
 }
 if(path==='email-otp'){
  const input=JSON.parse(opts.body);
  assert.equal(input.email,identity.email);
  assert.equal(input.otp,'123456');
  const headers=new Headers();
  if(otpCorrect){
   headers.append('Set-Cookie','better-auth.session_token=fake_authorized_session; Path=/; Secure; HttpOnly');
   return {ok:true,status:200,headers,json:async()=>({user:identity,session:{id:'session-1'}})};
  }
  return {ok:false,status:401,headers,json:async()=>({error:{code:'INVALID_OTP'}})};
 }
 throw Error('Rota não esperada em mock '+path);
};
const headers={host:'opanquecao.vercel.app',origin:'https://opanquecao.vercel.app'};
async function request(action,body={},h=headers){
 const response={code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};
 await backoffice({method:'POST',body:{action,...body},headers:h},response);
 return response;
}
(async()=>{
 const html=fs.readFileSync('backoffice/index.html','utf8');
 const client=fs.readFileSync('backoffice/app.js','utf8');
 const migration=fs.readFileSync('neon/migrations/002_staff_otp_throttle.sql','utf8');
 assert.match(html,/id="otpForm"/);
 assert.match(html,/id="otpCode"/);
 assert.match(client,/request_otp/);
 assert.match(client,/login_otp/);
 assert.doesNotMatch(client,/localStorage|sessionStorage/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS otp_requested_at/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS scenario/);
 const good=await request('request_otp',{email:identity.email});
 assert.equal(good.code,200);assert.equal(good.body.requested,true);
 assert.equal(providerCalls.length,1,'Apenas um e-mail por janela');
 const throttle=await request('request_otp',{email:identity.email});
 assert.equal(throttle.code,200);assert.equal(providerCalls.length,1);
 authorized=false;
 const stranger=await request('request_otp',{email:'nao-autorizado@exemplo.invalid'});
 assert.equal(stranger.code,200);assert.equal(providerCalls.length,1);
 assert.deepEqual(stranger.body,throttle.body,'Não identificar se e-mail é autorizado');
 const savedFetch=global.fetch;
 authorized=true;claimCount=0;
 global.fetch=async()=>({ok:false,status:404,headers:new Headers(),json:async()=>({error:{code:'ENDPOINT_NOT_FOUND'}})});
 const unavailable=await request('request_otp',{email:identity.email});
 assert.equal(unavailable.code,503);
 assert.equal(releaseCount,1,'Falha de envio precisa liberar bloqueio OTP');
 assert.doesNotMatch(unavailable.body.error,/Credenciais inválidas/);
 global.fetch=savedFetch;
 const badOrigin=await request('request_otp',{email:identity.email},{...headers,origin:'https://site-malicioso.invalid'});
 assert.equal(badOrigin.code,403);assert.equal(providerCalls.length,1);
 const badEmail=await request('request_otp',{email:'nao-e-email'});
 assert.equal(badEmail.code,400);
 const badCode=await request('login_otp',{email:identity.email,otp:'AAA123'});
 assert.equal(badCode.code,400);
 const valid=await request('login_otp',{email:identity.email,otp:'123456'});
 assert.equal(valid.code,200);
 assert.equal(valid.body.actor.role,'manager');
 assert.ok(valid.headers['Set-Cookie'].every(x=>x.includes('HttpOnly')&&x.includes('SameSite=Strict')));
 assert.doesNotMatch(JSON.stringify(valid.body),/fake_authorized_session|123456/);
 otpCorrect=false;
 const rejected=await request('login_otp',{email:identity.email,otp:'123456'});
 assert.equal(rejected.code,401);
 console.log('PASS OTP BACKOFFICE: allowlist, 90s throttle, anti-enumeracao, CSRF, sessao HttpOnly e codigos invalidos.');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>{
 db.staff=original.staff;db.claimStaffOtp=original.claim;db.releaseStaffOtp=original.release;global.fetch=original.fetch;
 for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
