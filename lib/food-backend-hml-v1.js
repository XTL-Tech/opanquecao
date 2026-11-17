'use strict';
// XTL Food backend HML adapter: NOT wired into production checkout.
// Only validated/repriced server-side orders may call this RPC.
const {createHash} = require('node:crypto');
const UUID4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const URL_PATTERN=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i;
class BackendPhase1Unavailable extends Error {}
class BackendPhase1Conflict extends Error {}
function configuration(env=process.env) {
    if(env.VERCEL_ENV==='production'||env.FOOD_BACKEND_V1_MODE!=='hml')
        throw new BackendPhase1Unavailable('Backend habilitado somente na homologação');
    if(typeof env.FOOD_SUPABASE_URL!=='string'||!URL_PATTERN.test(env.FOOD_SUPABASE_URL)
       ||typeof env.FOOD_SUPABASE_SECRET_KEY!=='string'||env.FOOD_SUPABASE_SECRET_KEY.length<24)
        throw new BackendPhase1Unavailable('Banco dedicado de HML não configurado');
    return {url:env.FOOD_SUPABASE_URL,key:env.FOOD_SUPABASE_SECRET_KEY};
}
function validate(order){
    if(!order||typeof order!=='object'||order.restaurantId!=='opanquecao'
       ||!UUID4.test(order.requestId||'')||!/^[a-f0-9]{8}$/.test(order.publicRef||'')
       ||!/^[a-f0-9]{64}$/.test(order.payloadSha256||''))
        throw new TypeError('Identidade inválida');
    if(order.serverVerified!==true||order.pricesVerified!==true||order.turnstileVerified!==true)
        throw new TypeError('Validação no servidor obrigatória');
    if(!order.contact||typeof order.contact.name!=='string'||typeof order.contact.phone!=='string'
       ||!Array.isArray(order.items)||!order.items.length||order.items.length>50
       ||!order.fulfillment||!order.payment
       ||!Number.isSafeInteger(order.subtotalCents)||order.subtotalCents<0
       ||(order.deliveryFeeCents!==null&&(!Number.isSafeInteger(order.deliveryFeeCents)||order.deliveryFeeCents<0)))
        throw new TypeError('Pedido normalizado inválido');
    if(JSON.stringify({contact:order.contact,items:order.items,fulfillment:order.fulfillment,payment:order.payment}).length>35000)
        throw new TypeError('Pedido acima do limite');
}
function digestValidatedOrder(order){
    validate({...order,payloadSha256:order.payloadSha256||'0'.repeat(64)});
    return createHash('sha256').update(JSON.stringify({
        contact:order.contact,items:order.items,fulfillment:order.fulfillment,
        payment:order.payment,subtotalCents:order.subtotalCents,
        deliveryFeeCents:order.deliveryFeeCents
    })).digest('hex');
}
async function stageOrderInHml(order,{env=process.env,fetchImpl=fetch}={}){
    const {url,key}=configuration(env);
    validate(order);
    if(digestValidatedOrder(order)!==order.payloadSha256)
        throw new TypeError('Hash não corresponde ao pedido validado');
    const params={
        p_restaurant_id:order.restaurantId,p_request_id:order.requestId,
        p_public_ref:order.publicRef,p_payload_sha256:order.payloadSha256,
        p_contact:order.contact,p_items:order.items,p_fulfillment:order.fulfillment,
        p_payment:order.payment,p_subtotal_cents:order.subtotalCents,
        p_delivery_fee_cents:order.deliveryFeeCents
    };
    let response;
    try{
        response=await fetchImpl(url+'/rest/v1/rpc/xtl_food_accept_order_v1',{
            method:'POST',cache:'no-store',headers:{
                apikey:key,'Content-Type':'application/json',Accept:'application/json'
            },body:JSON.stringify(params),signal:AbortSignal.timeout(6000)
        });
    }catch{
        throw new BackendPhase1Unavailable('Banco HML temporariamente indisponível');
    }
    if(!response?.ok)
        throw new BackendPhase1Unavailable('Banco não confirmou o pedido');
    let result;
    try{result=await response.json();}
    catch{throw new BackendPhase1Unavailable('Resposta do banco inválida');}
    if(!result||typeof result!=='object')
        throw new BackendPhase1Unavailable('Resposta do banco inesperada');
    if(result.outcome==='conflict')
        throw new BackendPhase1Conflict('Identificador já utilizado para outro conteúdo');
    if(!['accepted','replayed'].includes(result.outcome)
       ||!UUID4.test(result.order_id)
       ||result.public_ref!==order.publicRef
       ||typeof result.status!=='string')
        throw new BackendPhase1Unavailable('Contrato do banco incompatível');
    return {outcome:result.outcome,orderId:result.order_id,
            publicRef:result.public_ref,status:result.status};
}
module.exports={
    configuration,validate,digestValidatedOrder,stageOrderInHml,
    BackendPhase1Unavailable,BackendPhase1Conflict
};
