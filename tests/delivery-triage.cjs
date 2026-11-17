'use strict';
const assert = require('node:assert/strict');
const {cepLookup,triageDelivery,distancePolicy,airDistanceKm} = require('../lib/delivery-triage');

const base = {
  city: 'Nova Hartz',
  neighborhood: 'Zona Rural',
  street: 'Estrada do Teste',
  postalCode: '93890-000',
  location: {latitude:-29.603,longitude:-50.92},
  baseFeeCents: 700
};
(async () => {
  let externalCalls=0;
  const noNetwork=async()=>{externalCalls++; throw Error('must never call external API for generic CEP');};
  for (const [cep,expected] of [
      ['93890-000','Nova Hartz'],['93893-000','Nova Hartz'],
      ['93880-000','Araricá']]) {
    const lookup=await cepLookup(cep,{fetchImpl:noNetwork});
    assert.equal(lookup.status,'ok');
    assert.equal(lookup.city,expected);
    assert.equal(lookup.scope,'city_or_locality');
    assert.equal(lookup.neighborhood,'');
    assert.equal(lookup.street,'');
  }
  assert.equal(externalCalls,0);

  const r=await triageDelivery(base,{fetchImpl:noNetwork,env:{}});
  assert.equal(r.status,'standard_estimate');
  assert.deepEqual(r.reasons,[]);
  assert.equal(r.feeCents,700);
  assert.equal(r.manualConfirmationRequired,true);
  assert.equal(r.cepVerifiesNeighborhood,false);
  assert.equal(r.cepVerifiesStreet,false);
  assert.equal(r.postalEvidence,'city_only');

  // Same CEP must NOT be used to infer shorter distance or override the bairro.
  const sameCepOtherBairro=await triageDelivery({...base,neighborhood:'Centro'},{
    fetchImpl:noNetwork,env:{}
  });
  assert.equal(sameCepOtherBairro.feeCents,700);
  assert.deepEqual(sameCepOtherBairro.reasons,[]);

  // City mismatch is a real triage warning, independent of bairro.
  const mismatch=await triageDelivery({...base,postalCode:'93880-000'},{
    fetchImpl:noNetwork,env:{}
  });
  assert.equal(mismatch.status,'needs_review');
  assert.equal(mismatch.feeCents,null);
  assert.ok(mismatch.reasons.includes('cep_city_conflict'));

  // Some exceptional CEPs may include a bairro/street. Do not compare those
  // against customer-declared bairro for Nova Hartz/Araricá.
  const special=await triageDelivery({...base,postalCode:'93890-970'},{
    fetchImpl:async()=>({
      ok:true,json:async()=>({uf:'RS',localidade:'Nova Hartz',
        bairro:'Centro',logradouro:'Rua Jacob Pilger'})
    }),env:{}
  });
  assert.equal(special.status,'standard_estimate');
  assert.deepEqual(special.reasons,[]);
  assert.equal(special.cepVerifiesNeighborhood,false);

  const noCep=await triageDelivery({...base,postalCode:''},{env:{},fetchImpl:noNetwork});
  assert.equal(noCep.feeCents,700);
  assert.equal(noCep.manualConfirmationRequired,true);

  const noConnection=await triageDelivery({...base,postalCode:'93890-123'},{
    fetchImpl:async()=>{throw Error('timeout');},env:{}
  });
  assert.equal(noConnection.feeCents,700);
  assert.equal(noConnection.postalEvidence,'unavailable');

  // Distance pricing is opt-in OFF by default and needs owner-approved origin/rates.
  assert.equal(distancePolicy({DELIVERY_DISTANCE_PRICING:'enabled'}),null);
  const configured={
    DELIVERY_DISTANCE_PRICING:'enabled',
    DELIVERY_STORE_LOCATION_VERIFIED:'true',
    DELIVERY_TARIFFS_OWNER_APPROVED:'true',
    DELIVERY_STORE_LAT:'-29.58',
    DELIVERY_STORE_LON:'-50.92',
    DELIVERY_FEE_DISTANCE_TIERS_JSON:JSON.stringify({
      'Nova Hartz':[{maxKm:2,feeCents:700},{maxKm:6,feeCents:1200}],
      'Araricá':[{maxKm:4,feeCents:1000},{maxKm:10,feeCents:1800}]
    })
  };
  assert.ok(airDistanceKm({latitude:-29.58,longitude:-50.92},base.location)>2);
  const gpsNotConfirmed=await triageDelivery(base,{fetchImpl:noNetwork,env:configured});
  assert.equal(gpsNotConfirmed.feeCents,700);
  assert.equal(gpsNotConfirmed.airKm,null);

  const gpsConfirmed=await triageDelivery({
    ...base,gpsConfirmedAsDeliveryDestination:true
  },{fetchImpl:noNetwork,env:configured});
  assert.equal(gpsConfirmed.status,'distance_estimate');
  assert.equal(gpsConfirmed.feeCents,1200);
  assert.equal(gpsConfirmed.manualConfirmationRequired,true);
  assert.match(gpsConfirmed.distanceMethod,/straight_line/);

  // Monotonic fees: no lower fee for farther area.
  const reversed={...configured,DELIVERY_FEE_DISTANCE_TIERS_JSON:JSON.stringify({
    'Nova Hartz':[{maxKm:2,feeCents:1200},{maxKm:6,feeCents:700}],
    'Araricá':[{maxKm:4,feeCents:1000}]
  })};
  assert.equal(distancePolicy(reversed),null);
  console.log('PASS: CEP city-only, mismatch triage, no false bairro match, distance pricing gated');
})().catch(error=>{console.error(error);process.exitCode=1;});
