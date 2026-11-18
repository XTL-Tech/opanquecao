'use strict';
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');

// HML only. This endpoint cannot choose arbitrary recipients or send arbitrary text.
const compare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first=Buffer.from(a), second=Buffer.from(b);
  return first.length===second.length && timingSafeEqual(first,second);
};
const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0,16);

async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Allow','POST');
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'method_not_allowed'});
  const triggerKey=process.env.WA_HML_TRIGGER_KEY || '';
  const accessToken=process.env.WA_HML_ACCESS_TOKEN || '';
  const phoneId=process.env.WA_HML_PHONE_NUMBER_ID || '';
  const recipient=process.env.WA_HML_TEST_RECIPIENT || '';
  // A dedicated Meta test sender/recipient must be configured before sending.
  if(triggerKey.length<32 || !accessToken || !/^\d{6,24}$/.test(phoneId) || !/^\d{10,15}$/.test(recipient)){
    return res.status(503).json({ok:false,error:'hml_not_configured'});
  }
  if(!compare(req.headers?.['x-xtl-wa-hml-key'], triggerKey)){
    return res.status(403).json({ok:false,error:'not_authorized'});
  }
  const type=req.body?.type;
  if(type!=='hello_world' && type!=='order'){
    return res.status(400).json({ok:false,error:'invalid_test_type'});
  }
  const version=process.env.WA_HML_GRAPH_VERSION || 'v26.0';
  if(!/^v\d{1,2}\.0$/.test(version)) return res.status(503).json({ok:false,error:'invalid_api_version'});
  const marker='XTL-HML-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+randomBytes(6).toString('hex').toUpperCase();
  const message=(type==='hello_world')
    ? {messaging_product:'whatsapp',to:recipient,type:'template',template:{name:'hello_world',language:{code:'en_US'}}}
    : {messaging_product:'whatsapp',to:recipient,type:'text',text:{preview_url:false,
      body:'*TESTE — NÃO PREPARAR*\n'+marker+'\n1. 1x Panqueca Bacon - Tam.: G - Obs.: sem cebola\n2. 1x Açaí Panquecão - Tam.: 500ml - Adicionais: Nutella\nMensagem exclusivamente de homologação.'}};
  let answer, payload;
  try {
    answer=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{
      method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify(message),signal:AbortSignal.timeout(12000)
    });
    payload=await answer.json();
  } catch {
    return res.status(502).json({ok:false,error:'meta_unreachable'});
  }
  if(!answer.ok || !payload?.messages?.[0]?.id){
    const code=Number.isInteger(payload?.error?.code)?payload.error.code:null;
    console.info(JSON.stringify({event:'XTL_WA_HML_SEND',kind:type,outcome:'rejected',httpStatus:answer.status,providerCode:code}));
    return res.status(502).json({ok:false,error:'meta_rejected',providerStatus:answer.status,providerCode:code});
  }
  const messageIdHash=hash(payload.messages[0].id);
  console.info(JSON.stringify({event:'XTL_WA_HML_SEND',kind:type,outcome:'accepted_not_delivered',messageIdHash,testMarker:type==='order'?marker:null}));
  return res.status(202).json({ok:true,acceptedByMeta:true,delivered:false,messageIdHash,testMarker:type==='order'?marker:null});
}
module.exports=handler;
