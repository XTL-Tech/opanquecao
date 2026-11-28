'use strict';
const {createHmac}=require('node:crypto');
const {AccountError}=require('./customer-auth');
function enabled(){return process.env.DELIVERY_ACCOUNT_REQUIRED==='true'||process.env.DIGITAL_ORDERS_ENABLED==='true';}
function normalizeCpf(value){
 if(typeof value!=='string'||!/^\s*(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})\s*$/.test(value))throw new AccountError('Informe um CPF válido.');
 const cpf=value.replace(/\D/g,'');
 if(/^(\d)\1{10}$/.test(cpf))throw new AccountError('Informe um CPF válido.');
 for(const n of [9,10]){
  const sum=cpf.slice(0,n).split('').reduce((s,d,i)=>s+Number(d)*(n+1-i),0);
  const digit=(sum*10)%11%10;
  if(digit!==Number(cpf[n]))throw new AccountError('Informe um CPF válido.');
 }
 return cpf;
}
function fingerprint(value){
 const cpf=normalizeCpf(value),key=process.env.CUSTOMER_CPF_HMAC_KEY;
 if(!/^[a-f0-9]{64}$/i.test(key||''))throw new AccountError('Cadastro indisponível.',503);
 return {hash:createHmac('sha256',Buffer.from(key,'hex')).update('opanquecao:cpf:v1:'+cpf).digest('hex'),last2:cpf.slice(-2)};
}
async function requireDeliveryAccount(req,name,phone){
 const auth=require('./customer-auth'),data=require('./customer-accounts');
 const cfg=auth.config();auth.originGuard(req,cfg,true);
 const who=await auth.actor(req,cfg),p=await data.profile(who.subject);
 if(!p?.hasCpf||!p.name||!p.phone)throw new AccountError('Complete seu cadastro com CPF em Minha conta.',403);
 if(p.name!==name||p.phone!==phone)throw new AccountError('Use os dados de contato da sua conta ou atualize seu cadastro.',403);
 return who.subject;
}
module.exports={enabled,normalizeCpf,fingerprint,requireDeliveryAccount};
