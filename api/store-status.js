'use strict';
const { loadStoreStatus } = require('../lib/store-hours-source');
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Método inválido'});
  try {
    const status = await loadStoreStatus();
    // Nunca informar horários inexistentes nem afirmar disponibilidade de notificações não ativadas.
    return res.status(200).json({...status, canSubscribe:false, timeZone:'America/Sao_Paulo'});
  } catch {
    return res.status(503).json({enabled:true,open:false,unknown:true,canSubscribe:false,
      timeZone:'America/Sao_Paulo',message:'Não foi possível confirmar o horário da loja.'});
  }
};
