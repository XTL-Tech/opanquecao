'use strict';

// XTL Food: server-only address/fee triage. CEP is a signal, NOT proof of residence.
// This module never accepts a delivery fee from the browser; no PII in logs.
// No external location service receives customer GPS or street/number.
const CITIES = ['Nova Hartz','Araricá'];
// CEPs gerais/localidade, não de logradouro; Campo Vicente também tem CEP de localidade.
// Nunca inferir bairro, rua ou distância a partir destes códigos.
const GENERAL_LOCALITY_CEPS = Object.freeze({
    '93890000': 'Nova Hartz',
    '93893000': 'Nova Hartz',
    '93880000': 'Araricá'
});

function normalized(text) {
    return typeof text === 'string'
        ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/\b(?:rua|avenida|av|travessa|estrada|rodovia)\b/g, '')
            .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
}
function validPoint(x) {
    return x && typeof x === 'object'
        && Number.isFinite(x.latitude) && Number.isFinite(x.longitude)
        && Math.abs(x.latitude) <= 90 && Math.abs(x.longitude) <= 180;
}
function airDistanceKm(a,b) {
    if (!validPoint(a) || !validPoint(b)) return null;
    const R = 6371.0088, rad = n => n * Math.PI / 180;
    const dLat = rad(b.latitude-a.latitude), dLon = rad(b.longitude-a.longitude);
    const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*
        Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(Math.min(1,Math.max(0,h))),
                         Math.sqrt(1-Math.min(1,Math.max(0,h))));
}

// The owner must verify the exact store entrance and every fee tier.
// Air distance is a LOWER BOUND, not a road route and cannot prove an address.
// Return null rather than silently applying arbitrary/invented prices.
function distancePolicy(env=process.env) {
    if (env.DELIVERY_DISTANCE_PRICING !== 'enabled' ||
        env.DELIVERY_STORE_LOCATION_VERIFIED !== 'true' ||
        env.DELIVERY_TARIFFS_OWNER_APPROVED !== 'true') return null;
    const latitude = Number(env.DELIVERY_STORE_LAT);
    const longitude = Number(env.DELIVERY_STORE_LON);
    if (!env.DELIVERY_STORE_LAT || !env.DELIVERY_STORE_LON ||
        !validPoint({latitude,longitude}) ||
        !env.DELIVERY_FEE_DISTANCE_TIERS_JSON) return null;
    let tiers;
    try { tiers=JSON.parse(env.DELIVERY_FEE_DISTANCE_TIERS_JSON); }
    catch { return null; }
    if (!tiers || typeof tiers !== 'object') return null;
    for (const city of CITIES) {
        const arr = tiers[city];
        if (!Array.isArray(arr) || !arr.length || arr.length>15) return null;
        let lastKm=0,lastFee=0;
        for (const t of arr) {
            if (!t || !Number.isFinite(t.maxKm) || t.maxKm<=lastKm ||
                !Number.isSafeInteger(t.feeCents) || t.feeCents<lastFee ||
                t.feeCents<0 || t.feeCents>10000) return null;
            lastKm=t.maxKm;lastFee=t.feeCents;
        }
    }
    return {origin:{latitude,longitude},tiers};
}
function estimatedDistanceFee({city,location,baseFeeCents},env=process.env) {
    const policy=distancePolicy(env);
    if (!policy || !validPoint(location) || !CITIES.includes(city)) return null;
    const km=airDistanceKm(policy.origin,location);
    const tier=policy.tiers[city].find(t=>km<=t.maxKm);
    if (!tier) return {airKm:Math.round(km*10)/10, feeCents:null, outOfRange:true};
    if (tier.feeCents<baseFeeCents) return null; // Can't undercut the city's minimum.
    return {airKm:Math.round(km*10)/10,feeCents:tier.feeCents,outOfRange:false};
}
async function cepLookup(cep,{fetchImpl=fetch,timeoutMs=2200}={}) {
    const digits=typeof cep==='string'?cep.replace(/\D/g,''):'';
    if(!/^\d{8}$/.test(digits)) return {status:'not_provided'};
    // Common municipality/locality-wide CEPs need no external lookup.
    // These are NOT evidence of street, neighborhood, route or customer residence.
    if (Object.prototype.hasOwnProperty.call(GENERAL_LOCALITY_CEPS, digits)) {
        return {status:'ok',city:GENERAL_LOCALITY_CEPS[digits],uf:'RS',
            neighborhood:'',street:'',scope:'city_or_locality'};
    }
    // Other postal codes, including special-address/agency codes, validate CITY only.
    // No street, number, name, GPS or tokens are transmitted to ViaCEP.
    try {
        const response=await fetchImpl('https://viacep.com.br/ws/'+digits+'/json/',{
            method:'GET',headers:{Accept:'application/json'},
            signal:AbortSignal.timeout(timeoutMs),cache:'no-store'
        });
        if(!response.ok)return {status:'unavailable'};
        const data=await response.json();
        if(data?.erro===true)return {status:'unknown_cep'};
        if(!data||typeof data!=='object'||typeof data.uf!=='string'||
           typeof data.localidade!=='string')return {status:'unavailable'};
        return {status:'ok',city:data.localidade,uf:data.uf,
            neighborhood:typeof data.bairro==='string'?data.bairro:'',
            street:typeof data.logradouro==='string'?data.logradouro:''};
    }catch{return {status:'unavailable'};}
}
async function triageDelivery(input,{env=process.env,fetchImpl=fetch}={}) {
    const {city,postalCode,location,baseFeeCents}=input;
    const reasons=[];
    const lookup=await cepLookup(postalCode,{fetchImpl});
    if (lookup.status==='ok') {
        if(normalized(lookup.city)!==normalized(city)||normalized(lookup.uf)!=='rs') {
            reasons.push('cep_city_conflict');
        }
        // Municipality-wide postal codes cannot verify street/neighborhood.
        // Even when a special CEP supplies street/bairro, do not infer that
        // the customer lives there: only compare the municipality/UF.
    } else if (lookup.status==='unknown_cep') reasons.push('cep_unknown');
    // An unavailable external API never blocks an otherwise valid checkout.
    // The browser GPS is the device's position, not necessarily the delivery address.
    // Require a SEPARATE, explicit confirmation that the pin is the destination;
    // such a confirmation is not yet captured by the checkout in production.
    const estimate=input.gpsConfirmedAsDeliveryDestination===true
        ?estimatedDistanceFee({city,location,baseFeeCents},env):null;
    if(estimate?.outOfRange) reasons.push('distance_outside_coverage');
    // Explicitly mark the limit of verification (GPS can be spoofed).
    const needsReview=reasons.length>0;
    return {
        status:needsReview?'needs_review':estimate?.feeCents!==null&&estimate?
            'distance_estimate':'standard_estimate',
        reasons,
        // These cities use generic locality CEPs: the street, number and
        // neighborhood always need operational confirmation, even on CEP match.
        manualConfirmationRequired:true,
        cepVerifiesNeighborhood:false,
        cepVerifiesStreet:false,
        feeCents:needsReview?null:(estimate?.feeCents ?? baseFeeCents),
        airKm:estimate?.airKm??null,
        postalEvidence:lookup.status==='ok'?'city_only':lookup.status,
        // Never return the customer's ZIP, street, GPS or personal details.
        distanceMethod:estimate?'straight_line_estimate_not_road_route':null
    };
}
module.exports={
    normalized,validPoint,airDistanceKm,cepLookup,distancePolicy,
    estimatedDistanceFee,triageDelivery
};
