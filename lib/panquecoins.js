'use strict';
const db=require('./backoffice-neon'),crypto=require('node:crypto'),{AccountError}=require('./customer-auth');
const enabled=()=>process.env.PANQUECOINS_ENROLLMENT_ENABLED==='true';
function birthDate(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new AccountError('Informe sua data de nascimento.');
 const d=new Date(v+'T12:00:00Z'),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v||v<'1900-01-01'||v>today)throw new AccountError('Informe uma data de nascimento válida.');
 return v;
}
function challengeHash(subject,code){
 const key=process.env.CUSTOMER_CPF_HMAC_KEY;
 if(!/^[0-9a-f]{64}$/i.test(key||''))throw new AccountError('Verificação temporariamente indisponível.',503);
 return crypto.createHmac('sha256',Buffer.from(key,'hex')).update('opanquecao:phone:v1:'+subject+':'+code).digest('hex');
}
async function requestPhone(subject){
 if(!enabled())throw new AccountError('Cadastro indisponível.',503);
 const code=String(crypto.randomInt(10000000,100000000)),hash=challengeHash(subject,code);
 const rows=await db.run("UPDATE dp.customer_accounts SET phone_challenge_hash=$2,phone_challenge_at=now() WHERE subject=$1 AND cpf_hash IS NOT NULL AND birth_date IS NOT NULL AND loyalty_terms_at IS NOT NULL AND phone<>'' AND phone_verified_at IS NULL AND (phone_challenge_at IS NULL OR phone_challenge_at<now()-interval '60 seconds') RETURNING phone",[subject,hash]);
 if(!rows.length)throw new AccountError('Complete seu cadastro, ou aguarde 60 segundos antes de solicitar outro código.',409);
 return {code,expiresMinutes:30};
}
async function verifyPhone(actor,body){
 if(!enabled()||!['manager','admin'].includes(actor.role))throw new AccountError('Acesso restrito.',403);
 const subject=body.subject,code=String(body.code||''),phone=String(body.phone||'').replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
 if(typeof subject!=='string'||subject.length<4||subject.length>150||!/^\d{8}$/.test(code)||!/^\d{10,11}$/.test(phone)||body.confirmed!==true)throw new AccountError('Confira o código e o número real do remetente no WhatsApp.');
 const rows=await db.run("UPDATE dp.customer_accounts SET phone_verified_at=now(),phone_verified_by=$4,phone_challenge_hash=NULL,phone_challenge_at=NULL WHERE subject=$1 AND phone=$2 AND phone_challenge_hash=$3 AND phone_challenge_at>now()-interval '30 minutes' AND phone_verified_at IS NULL RETURNING subject",[subject,phone,challengeHash(subject,code),actor.id]);
 if(!rows.length)throw new AccountError('Código incorreto, expirado ou número divergente.',409);
 return {verified:true};
}
function rewardCents(subtotalCents){
 if(!Number.isSafeInteger(subtotalCents)||subtotalCents<0)throw new Error('Valor inválido');
 return Math.floor(subtotalCents*5/100);
}
function minimumCents(catalog){
 const items=catalog?.categorias?.find(c=>c.id==='panquecas-doces')?.itens||[];
 const cents=items.filter(i=>i.available!==false).map(i=>String(i.tamanhos?.M||'').match(/^R\$\s*(\d+),(\d{2})$/)).filter(Boolean).map(m=>Number(m[1])*100+Number(m[2])).filter(n=>n>0);
 return cents.length?Math.min(...cents):null;
}
module.exports={enabled,birthDate,requestPhone,verifyPhone,rewardCents,minimumCents};
