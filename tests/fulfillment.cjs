'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const areas=JSON.parse(fs.readFileSync(path.resolve('delivery-areas.json'),'utf8'));
(async()=>{
    const {normalizeFulfillment,describeFulfillment,standardDeliveryFee}=await import(path.resolve('fulfillment.mjs'));
    const base={
        type:'delivery',city:'Nova Hartz',neighborhood:'Centro',
        street:'Rua das Flores',number:'123',complement:'Casa 2',
        reference:'Portão azul',latitude:-29.585,longitude:-50.938
    };
    for(const [city,entries] of Object.entries(areas.cities))for(const entry of entries)assert.equal(standardDeliveryFee(city,entry.name,areas),entry.feeCents??1000);
    for(const name of ["Campo da Brazina","Ferrabraz","Jardim","Bela Vista"])assert.equal(standardDeliveryFee('Araricá',name,areas),1500);
    for(const name of ["Alto Ferrabraz","Porto Palmeira","Linha Ferrabraz"])assert.equal(standardDeliveryFee('Araricá',name,areas),2000);
    assert.equal(standardDeliveryFee('Araricá','Centro',areas),1000);
    assert.equal(standardDeliveryFee('Nova Hartz','__other__',areas),null);
    assert.equal(standardDeliveryFee('Nova Hartz','Inventado',areas),null);
    for(const city of ['Parobé','Sapiranga']){
      assert.equal(standardDeliveryFee(city,'__other__',areas),3500);
      assert.equal(standardDeliveryFee(city,'',areas),null);
      assert.equal(normalizeFulfillment({...base,city,neighborhood:'__other__',otherNeighborhood:'Bairro de teste'},areas).city,city);
    }
    const delivery=normalizeFulfillment(base,areas);
    assert.equal(delivery.type,'delivery');
    assert.equal(delivery.city,'Nova Hartz');
    assert.equal(delivery.neighborhood,'Centro');
    assert.deepEqual(delivery.location,{latitude:-29.585,longitude:-50.938});
    const description=describeFulfillment(delivery).join('\n');
    assert.match(description,/Rua das Flores, 123/);
    assert.match(description,/maps\?q=-29\.585,-50\.938/);
    assert.match(description,/Taxa de entrega: A CONFIRMAR PELA LOJA/);
    assert.doesNotMatch(description,/R\$\s*(?:7|10),00/);
    const other=normalizeFulfillment({...base,city:'Araricá',neighborhood:'__other__',
        otherNeighborhood:'Localidade particular',latitude:undefined,longitude:undefined},areas);
    assert.equal(other.neighborhood,'Localidade particular');
    assert.equal(other.location,null);
    assert.throws(()=>normalizeFulfillment({...base,city:'Cidade desconhecida'},areas),/Nova Hartz ou Araricá/);
    assert.throws(()=>normalizeFulfillment({...base,neighborhood:'Inventado'},areas),/bairro válido/);
    assert.throws(()=>normalizeFulfillment({...base,number:''},areas),/número/);
    assert.throws(()=>normalizeFulfillment({...base,latitude:1000},areas),/GPS inválidas/);
    assert.throws(()=>normalizeFulfillment({...base,longitude:undefined},areas),/incompleta/);
    assert.throws(()=>normalizeFulfillment({...base,street:'a'},areas),/rua ou estrada/);
    assert.throws(()=>normalizeFulfillment({type:'delivery',city:'Nova Hartz'},areas),/bairro/);
    const pickup=normalizeFulfillment({type:'pickup'},areas);
    assert.equal(pickup.type,'pickup');
    assert.match(describeFulfillment(pickup).join(' '),/Retirada/);
    const table=normalizeFulfillment({type:'table',table:'Mesa 03'},areas);
    assert.equal(table.table,'Mesa 03');
    assert.match(describeFulfillment(table).join(' '),/Consumo no local/);
    assert.throws(()=>normalizeFulfillment({type:'table',table:''},areas),/comanda/);
    assert.throws(()=>normalizeFulfillment({type:'pickup',latitude:-29.5},areas),/apenas em entregas/);
    assert.throws(()=>normalizeFulfillment({type:'unknown'},areas),/Escolha/);
    assert.ok(!JSON.stringify(table).includes('cpf'));
    console.log('PASS: modalidades, campos obrigatórios, bairros, GPS opcional, sem CPF ou taxa inventada.');
})().catch(e=>{console.error(e);process.exitCode=1});
