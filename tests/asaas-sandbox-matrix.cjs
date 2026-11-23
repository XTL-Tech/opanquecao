'use strict';
/*
 * Testes de contrato do Asaas Sandbox. Nenhuma conexão externa é realizada:
 * fetch, Neon e Neon Auth são substituídos por simuladores em memória.
 * A conciliação SQL é conferida adicionalmente em ramificação isolada do Neon.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const db=require('../lib/backoffice-neon');
const auth=require('../lib/backoffice-neon-auth');
const checkout=require('../api/asaas-sandbox');
const webhook=require('../api/asaas-sandbox-webhook');
const sandboxSource=fs.readFileSync(require.resolve('../api/asaas-sandbox'),'utf8');
const neonSource=fs.readFileSync(require.resolve('../lib/backoffice-neon'),'utf8');
assert.match(neonSource,/status IN \('creating','active','uncertain'\)/,
 'Webhook atrasado não pode reativar checkout cancelado, expirado ou pago');
assert.doesNotMatch(sandboxSource,/https:\/\/api\.asaas\.com\/v3/,
 'Rotas de homologação jamais devem chamar a API de cobrança real');
assert.match(sandboxSource,/https:\/\/api-sandbox\.asaas\.com\/v3\/checkouts/);
const oldEnv=Object.fromEntries(['ASAAS_SANDBOX_ENABLED','ASAAS_SANDBOX_API_KEY',
 'ASAAS_SANDBOX_WEBHOOK_TOKEN','BACKOFFICE_ENABLED','BACKOFFICE_PROVIDER',
 'DATABASE_URL','NEON_AUTH_BASE_URL'].map(x=>[x,process.env[x]]));
const oldFetch=global.fetch;
const original={
 configured:db.configured,
 recent:db.sandboxRecent,claim:db.sandboxClaim,attach:db.sandboxAttach,
 uncertain:db.sandboxMarkUncertain,reconcile:db.sandboxConfirmAbsent,event:db.sandboxEvent,
 actor:auth.actor,authConfigured:auth.configured
};
const secret='test-webhook-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
Object.assign(process.env,{
 BACKOFFICE_ENABLED:'true',BACKOFFICE_PROVIDER:'neon',
 DATABASE_URL:'postgresql://fake:fake@ep-test.neon.tech/db',
 NEON_AUTH_BASE_URL:'https://auth.test.invalid/neondb/auth',
 ASAAS_SANDBOX_ENABLED:'true',ASAAS_SANDBOX_API_KEY:'SANDBOX_FAKE_KEY_NO_REAL_CHARGES',
 ASAAS_SANDBOX_WEBHOOK_TOKEN:secret
});
db.configured=()=>true;
auth.configured=()=>true;
auth.actor=async()=>({id:'gestor-ficticio',role:'manager'});
db.sandboxRecent=async()=>[];
const record={id:'2b18ec00-44d0-4b37-9c55-71eb444f199b',
 external_ref:'dp-sandbox-test-matrix',amount_cents:500};
db.sandboxClaim=async()=>({created:true,record});
let attached=[],uncertain=[],hits=[],transitions=[];
db.sandboxAttach=async(id,providerId)=>attached.push({id,providerId});
db.sandboxMarkUncertain=async(id)=>uncertain.push(id);
let reconciled=0;
db.sandboxConfirmAbsent=async(actorId,id)=>{reconciled++;assert.equal(actorId,'gestor-ficticio');assert.equal(id,record.id);return{reviewed:true};};
db.sandboxEvent=async(x)=>{transitions.push(x);return {matched:1,inserted:1,updated:1};};
const origin={host:'opanquecao.vercel.app',origin:'https://opanquecao.vercel.app'};
async function req(handler,method,body={},headers={}){
 const response={code:0,headers:{},setHeader(key,val){this.headers[key]=val;return this;},
 status(status){this.code=status;return this;},json(payload){this.body=payload;return this;}};
 await handler({method,body,headers},response);
 return response;
}
const providerResponse=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const fakeFetch=async(url,opts)=>{
 hits.push({url:String(url),method:opts.method,token:opts.headers.access_token,payload:JSON.parse(opts.body)});
 return providerResponse({id:'ch_sandbox_matrix_123456'});
};
(async()=>{
 global.fetch=fakeFetch;
 let response=await req(checkout,'GET',{},origin);
 assert.equal(response.code,200);
 assert.equal(response.body.enabled,true);
 assert.equal(response.body.mode,'sandbox');
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,201,'Criação de checkout simulado');
 assert.equal(response.body.amountCents,500);
 assert.match(response.body.link,/^https:\/\/asaas\.com\/checkoutSession\/show\?id=/);
 assert.equal(hits.length,1);
 assert.equal(hits[0].url,'https://api-sandbox.asaas.com/v3/checkouts');
 assert.equal(hits[0].token,'SANDBOX_FAKE_KEY_NO_REAL_CHARGES');
 assert.deepEqual(hits[0].payload.billingTypes,['PIX','CREDIT_CARD']);
 assert.deepEqual(hits[0].payload.chargeTypes,['DETACHED']);
 assert.equal(hits[0].payload.items[0].value,5);
 assert.match(hits[0].payload.callback.successUrl,/asaas-return\.html/);
 assert.equal(attached.length,1);

 // Diagnóstico de chave e acesso é GET somente-leitura para o Asaas, sem checkout.
 const connectionFetch=global.fetch;
 global.fetch=async(url,opts)=>{
  assert.equal(String(url),'https://api-sandbox.asaas.com/v3/myAccount/status/');
  assert.equal(opts.method,'GET');
  assert.equal(opts.body,undefined);
  return providerResponse({general:'APPROVED'},200);
 };
 let diagnostic=await req(checkout,'POST',{action:'check_sandbox_connection'},origin);
 assert.equal(diagnostic.code,200);assert.equal(diagnostic.body.connected,true);
 assert.equal(diagnostic.body.httpStatus,200);
 assert.equal(diagnostic.body.environment,'sandbox');
 global.fetch=async()=>providerResponse({errors:[{code:'invalid_token'}]},401);
 diagnostic=await req(checkout,'POST',{action:'check_sandbox_connection'},origin);
 assert.equal(diagnostic.code,200);assert.equal(diagnostic.body.connected,false);
 assert.equal(diagnostic.body.httpStatus,401);
 assert.equal(diagnostic.body.providerCode,'invalid_token');
 global.fetch=connectionFetch;
 assert.match(neonSource,/status='uncertain' AND reviewed_at IS NULL/,
  'Checkout incerto deve bloquear novas tentativas mesmo após janela de 10 minutos');

 // Conciliação não executa nenhuma operação no Asaas e exige confirmação explícita.
 let confirmResponse=await req(checkout,'POST',
  {action:'confirm_absent_sandbox_checkout',recordId:record.id,confirmation:'NO'},origin);
 assert.equal(confirmResponse.code,400);
 assert.equal(reconciled,0);
 confirmResponse=await req(checkout,'POST',
  {action:'confirm_absent_sandbox_checkout',recordId:record.id,
   confirmation:'CONFIRMO_AUSENCIA_NO_ASAAS'},origin);
 assert.equal(confirmResponse.code,200);
 assert.equal(confirmResponse.body.reviewed,true);
 assert.equal(reconciled,1);
 assert.match(fs.readFileSync('neon/migrations/003_asaas_uncertain_reconciliation.sql','utf8'),/reviewed_by/);
 // Não permitir criação sem autenticação, sem origem legítima ou sem habilitação.
 const before=hits.length;
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},
  {host:'opanquecao.vercel.app',origin:'https://invasor.invalid'});
 assert.equal(response.code,403);
 assert.equal(hits.length,before);
 auth.actor=async()=>{const e=Error('Sessão ausente');e.status=401;throw e;};
 response=await req(checkout,'GET',{},origin);
 assert.equal(response.code,401);
 auth.actor=async()=>({id:'atendente-ficticio',role:'attendant'});
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,403);
 auth.actor=async()=>({id:'gestor-ficticio',role:'manager'});
 process.env.ASAAS_SANDBOX_ENABLED='false';
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,503);assert.equal(hits.length,before);
 process.env.ASAAS_SANDBOX_ENABLED='true';

 // Idempotência antes da criação no provedor: reaproveitamento de checkout.
 db.sandboxClaim=async()=>({created:false,record:{provider_checkout_id:'ch_sandbox_reused'}});
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,200);assert.equal(response.body.reused,true);
 assert.equal(hits.length,before);
 db.sandboxClaim=async()=>({created:true,record});
 // Falhas/timeout do provedor => não fingir pagamento nem repetir silenciosamente.
 global.fetch=async()=>providerResponse({errors:[{code:'invalid_object'}]},400);
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,503);assert.equal(uncertain.length,1);
 assert.equal(response.body.providerStatus,400);
 assert.equal(response.body.providerCode,'invalid_object');
 global.fetch=async()=>{throw Error('ETIMEDOUT');};
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,503);assert.equal(uncertain.length,2);
 global.fetch=async()=>providerResponse({id:'BAD|INJECTION'},200);
 response=await req(checkout,'POST',{action:'create_sandbox_checkout'},origin);
 assert.equal(response.code,503);assert.equal(uncertain.length,3);
 global.fetch=fakeFetch;

 // Cenários isolados de Pix/cartão sem chamar endpoints de produção.
 const modes=[];
 db.sandboxClaim=async(actorId,scenario)=>{modes.push(scenario);return{created:true,record};};
 for(const [scenario,expected] of [['pix',['PIX']],['credit_card',['CREDIT_CARD']],['both',['PIX','CREDIT_CARD']]]){
  response=await req(checkout,'POST',{action:'create_sandbox_checkout',scenario},origin);
  assert.equal(response.code,201,scenario);
  assert.equal(response.body.scenario,scenario);
  assert.deepEqual(hits.at(-1).payload.billingTypes,expected);
 }
 assert.deepEqual(modes,['pix','credit_card','both']);
 const beforeInvalid=hits.length;
 response=await req(checkout,'POST',{action:'create_sandbox_checkout',scenario:'BOLETO'},origin);
 assert.equal(response.code,400);
 assert.equal(hits.length,beforeInvalid,'Boleto não é modalidade suportada no checkout hospedado');

 // Matriz de eventos: assinatura inválida, corpo incorreto, tipos permitidos.
 const hook=(event,id='evt_'+event)=>({id,event,
  checkout:{id:'ch_sandbox_matrix_123456',externalReference:record.external_ref}});
 response=await req(webhook,'GET');
 assert.equal(response.code,405);
 response=await req(webhook,'POST',hook('CHECKOUT_PAID'),{'asaas-access-token':'wrong'});
 assert.equal(response.code,401);
 response=await req(webhook,'POST',hook('PAYMENT_CONFIRMED'),{'asaas-access-token':secret});
 assert.equal(response.code,400);
 response=await req(webhook,'POST',{id:'evt_bad',event:'CHECKOUT_PAID',checkout:{id:'../../file'}},
  {'asaas-access-token':secret});
 assert.equal(response.code,400);
 for(const event of ['CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_CANCELED','CHECKOUT_EXPIRED']){
  response=await req(webhook,'POST',hook(event),{'asaas-access-token':secret});
  assert.equal(response.code,200,event);
 }
 assert.equal(transitions.length,4);
 assert.equal(transitions.find(x=>x.event==='CHECKOUT_PAID').checkout,'ch_sandbox_matrix_123456');
 process.env.ASAAS_SANDBOX_ENABLED='false';
 response=await req(webhook,'POST',hook('CHECKOUT_PAID'),{'asaas-access-token':secret});
 assert.equal(response.code,503);
 assert.equal(transitions.length,4);

 // Não há ramificação da função que atualize pagamentos reais ou pedidos.
 const hookSource=fs.readFileSync(require.resolve('../api/asaas-sandbox-webhook'),'utf8');
 assert.doesNotMatch(hookSource,/orderPaid|patchOrder|updateCustomer|purchase\(/i);
 console.log('PASS ASAAS MATRIX: mais de 20 cenários do backend simulados, sem requisições externas ou valores reais.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
 global.fetch=oldFetch;
 for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 Object.assign(db,{configured:original.configured,sandboxRecent:original.recent,
  sandboxClaim:original.claim,sandboxAttach:original.attach,
  sandboxMarkUncertain:original.uncertain,sandboxConfirmAbsent:original.reconcile,sandboxEvent:original.event});
 auth.actor=original.actor;auth.configured=original.authConfigured;
});
