'use strict';
const crypto=require('node:crypto');
const db=require('./backoffice-neon');
const c=require('./backoffice-core');
const {AuthError}=require('./backoffice-neon-auth');
const identity=require('./comandas');
const VERSION='ranking-2027-v1';
function yearOf(raw){const y=Number(raw||new Date().getFullYear());if(!Number.isInteger(y)||y<2026||y>2100)c.fail('Ano inválido.');return y;}
function staff(actor){if(!['admin','manager','attendant'].includes(actor.role))throw new AuthError('Acesso restrito.',403);}
function management(actor){if(!['admin','manager'].includes(actor.role))throw new AuthError('Acesso restrito à administração.',403);}
async function enroll(actor,body){
 staff(actor);const year=yearOf(body.year);
 if(body.consent!==true||body.version!==VERSION)c.fail('Registre a autorização expressa do cliente após apresentar o regulamento.');
 const key=identity.keyFor(identity.cpf(body.cpf));
 const alias='Panque '+crypto.randomBytes(5).toString('hex').toUpperCase();
 const rows=await db.run("INSERT INTO dp.ranking_participants(year,customer_id,public_alias,consent_version,recorded_by) SELECT $1,c.id,$3,$4,$5 FROM dp.customers c JOIN dp.ranking_campaigns k ON k.year=$1 AND k.published WHERE c.cpf_key=$2 ON CONFLICT(year,customer_id) DO UPDATE SET active=true,consented_at=now(),consent_version=excluded.consent_version,recorded_by=excluded.recorded_by RETURNING public_alias",[year,key,alias,VERSION,actor.id]);
 if(!rows.length)throw new db.StoreError('Campanha não liberada ou cadastro não identificado.',409);
 return {alias:rows[0].public_alias};
}
async function withdraw(actor,body){
 staff(actor);const year=yearOf(body.year),key=identity.keyFor(identity.cpf(body.cpf));
 await db.run("UPDATE dp.ranking_participants p SET active=false FROM dp.customers c WHERE p.customer_id=c.id AND c.cpf_key=$1 AND p.year=$2",[key,year]);
 return {ok:true};
}
// An in-person visit is a closed comanda, never an item or a kitchen ticket.
// Pending and fully/partially refunded orders are conservatively excluded until
// item-level adjustment and payment reconciliation are implemented.
const SQL=`WITH campaign AS (
 SELECT * FROM dp.ranking_campaigns WHERE year=$1
), eligible AS (
 SELECT o.*,t.closed_at,t.id AS tab_id
 FROM dp.orders o JOIN dp.ranking_participants p ON p.customer_id=o.customer_id AND p.year=$1 AND p.active
 CROSS JOIN campaign k LEFT JOIN dp.comandas t ON t.id=o.comanda_id
 WHERE o.status='delivered' AND o.payment_status='paid'
 AND ((o.fulfillment->>'type'<>'table' AND o.settled_business_date BETWEEN k.starts_on AND least(k.ends_on,(now() AT TIME ZONE 'America/Sao_Paulo')::date))
 OR (o.fulfillment->>'type'='table' AND t.state='closed' AND (t.closed_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN k.starts_on AND least(k.ends_on,(now() AT TIME ZONE 'America/Sao_Paulo')::date)))
 AND NOT EXISTS(SELECT 1 FROM dp.pix_refund_requests r WHERE r.request_id=o.request_id AND r.state IN ('approved','processing','confirmed','uncertain'))
), purchases AS (
 SELECT customer_id,count(DISTINCT coalesce(tab_id,request_id)) AS purchases,count(DISTINCT tab_id) AS visits FROM eligible GROUP BY customer_id
), pancake AS (
 SELECT customer_id,sum((i->>'cents')::bigint*(i->>'quantity')::int) AS spend FROM eligible CROSS JOIN LATERAL jsonb_array_elements(items) i
 WHERE i->>'category' LIKE 'panquecas-%' GROUP BY customer_id
), scores AS (
 SELECT p.public_alias,coalesce(s.purchases,0) AS purchases,coalesce(s.visits,0) AS visits,coalesce(v.spend,0) AS spend
 FROM dp.ranking_participants p JOIN purchases s ON s.customer_id=p.customer_id LEFT JOIN pancake v ON v.customer_id=p.customer_id
 WHERE p.year=$1 AND p.active
), ranked AS (
 SELECT 'pancake' AS category,public_alias,dense_rank() OVER(ORDER BY spend DESC) AS position FROM scores WHERE spend>0
 UNION ALL SELECT 'orders',public_alias,dense_rank() OVER(ORDER BY purchases DESC) FROM scores WHERE purchases>0
 UNION ALL SELECT 'visits',public_alias,dense_rank() OVER(ORDER BY visits DESC) FROM scores WHERE visits>0
)
SELECT category,public_alias,position FROM ranked WHERE position<=10 ORDER BY category,position,public_alias LIMIT 300`;
async function ranking(actor,query={}){
 management(actor);const year=yearOf(query.year);
 const campaign=(await db.run('SELECT year,starts_on,ends_on,published FROM dp.ranking_campaigns WHERE year=$1',[year]))[0];
 if(!campaign)return {year,published:false,entries:[]};
 const rows=await db.run(SQL,[year]);
 return {year,published:campaign.published,entries:rows.map(r=>({category:r.category,alias:r.public_alias,position:Number(r.position)}))};
}
async function fiscalRequest(actor,body){
 staff(actor);const id=String(body.id||'');if(!c.UUID.test(id))c.fail('Pedido ou comanda inválido.');
 const isTab=body.kind==='comanda';
 if(!isTab&&body.kind!=='order')c.fail('Tipo inválido.');
 const sql=isTab?"INSERT INTO dp.fiscal_documents(comanda_id,created_by) SELECT id,$2 FROM dp.comandas WHERE id=$1 AND state='closed' AND EXISTS(SELECT 1 FROM dp.orders WHERE comanda_id=$1 AND status='delivered' AND payment_status='paid') ON CONFLICT(comanda_id) WHERE comanda_id IS NOT NULL DO NOTHING RETURNING id,state":"INSERT INTO dp.fiscal_documents(request_id,created_by) SELECT request_id,$2 FROM dp.orders WHERE request_id=$1 AND comanda_id IS NULL AND status='delivered' AND payment_status='paid' ON CONFLICT(request_id) WHERE request_id IS NOT NULL DO NOTHING RETURNING id,state";
 const rows=await db.run(sql,[id,actor.id]);if(!rows.length)throw new db.StoreError('Operação não elegível ou já registrada.',409);
 return {document:rows[0],issued:false};
}
async function refundRequest(actor,body){
 staff(actor);const id=String(body.id||'');if(!c.UUID.test(id))c.fail('Pedido inválido.');
 const cents=c.cents(body.amountCents,1010000),reason=c.note(body.reason,400);
 if(cents<=0||reason.length<3)c.fail('Informe valor positivo e motivo.');
 const rows=await db.run('SELECT dp.request_pix_refund($1,$2,$3,$4) AS id',[id,cents,reason,actor.id]);
 if(!rows[0]?.id)throw new db.StoreError('Pedido não pago via Pix ou valor indisponível para devolução.',409);
 return {id:rows[0].id,state:'requested',transferred:false};
}
async function queues(actor){
 management(actor);
 const [fiscal,refunds]=await Promise.all([
 db.run("SELECT id,request_id,comanda_id,state,created_at FROM dp.fiscal_documents ORDER BY created_at DESC LIMIT 100"),
 db.run("SELECT r.id,o.ref_code,r.amount_cents,r.reason,r.state,r.created_at FROM dp.pix_refund_requests r JOIN dp.orders o ON o.request_id=r.request_id ORDER BY r.created_at DESC LIMIT 100")
 ]);
 return {fiscal,refunds,externalEnabled:false};
}
module.exports={ranking,enroll,withdraw,fiscalRequest,refundRequest,queues,SQL,VERSION};
