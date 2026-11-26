'use strict';
const auth=require('../lib/customer-auth');
const data=require('../lib/customer-accounts');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
 res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const cfg=auth.config(),method=req.method;
  if(!['GET','POST'].includes(method))return res.status(405).json({error:'Método inválido.'});
  auth.originGuard(req,cfg,method==='POST');
  if(method==='GET'&&req.query?.action==='config')return res.status(200).json({enabled:true,siteKey:process.env.TURNSTILE_SITE_KEY});
  const body=req.body||{};
  if(typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>12000)throw new auth.AccountError('Dados inválidos.');
  const action=method==='GET'?req.query?.action||'state':body.action;
  if(method==='POST'&&action==='otp_request')return res.status(200).json(await auth.requestOtp(req,cfg,body));
  if(method==='POST'&&action==='otp_verify'){const who=await auth.verifyOtp(req,res,cfg,body);return res.status(200).json({email:who.email,profile:await data.profile(who.subject)});}
  if(method==='POST'&&action==='logout')return res.status(200).json(await auth.logout(req,res,cfg));
  const who=await auth.actor(req,cfg);
  if(method==='GET'&&action==='state')return res.status(200).json({email:who.email,profile:await data.profile(who.subject)});
  if(method==='GET'&&action==='addresses')return res.status(200).json(await data.list(who.subject,req.query?.after));
  if(method==='POST'&&action==='profile_save')return res.status(200).json({profile:await data.saveProfile(who.subject,body)});
  if(method==='POST'&&action==='address_save')return res.status(200).json({address:await data.saveAddress(who.subject,body)});
  if(method==='POST'&&action==='address_delete')return res.status(200).json(await data.removeAddress(who.subject,body));
  return res.status(404).json({error:'Operação desconhecida.'});
 }catch(e){const status=e instanceof auth.AccountError?e.status:e.isValidation?400:503;return res.status(status).json({error:status===503?'Serviço temporariamente indisponível.':e.message});}
};
