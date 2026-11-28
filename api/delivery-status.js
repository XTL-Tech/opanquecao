'use strict';
// Capability: the full random UUID is known only by the ordering browser
// and the authenticated staff. Never return customer, address or order contents.
const db=require('../lib/backoffice-neon');
const {UUID}=require('../lib/backoffice-core');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'Método inválido'});
 if(!db.configured())return res.status(503).json({error:'Acompanhamento indisponível'});
 const id=req.body?.id;
 if(typeof id!=='string'||!UUID.test(id))return res.status(400).json({error:'Pedido inválido'});
 try{
  const rows=await db.run("SELECT status FROM dp.orders WHERE request_id=$1 AND origin='site' AND fulfillment->>'type' IN ('delivery','pickup','table') AND created_at>now()-interval '24 hours' LIMIT 1",[id]);
  if(!rows.length)return res.status(404).json({error:'Acompanhamento indisponível'});
  return res.status(200).json({status:rows[0].status});
 }catch{return res.status(503).json({error:'Acompanhamento indisponível'});}
};
