'use strict';
const {UUID_V4}=require('../lib/order-idempotency');
const {enabled,initReviewStore,tokenMatches}=require('../lib/order-review');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método inválido'});
 if(!enabled())return res.status(404).json({error:'Não disponível'});
 const id=req.query?.requestId,token=req.query?.token;
 if(typeof id!=='string'||!UUID_V4.test(id)||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return res.status(404).json({error:'Pedido não encontrado'});
 try{
  const row=await initReviewStore().get(id);
  if(!row||!tokenMatches(token,row.tracking_sha256))return res.status(404).json({error:'Pedido não encontrado'});
  return res.status(200).json({id:row.order_ref,status:row.status,
   reason:row.status==='rejected'?row.rejection_reason:null,updatedAt:row.updated_at});
 }catch{return res.status(503).json({error:'Status temporariamente indisponível'});}
};
