'use strict';
const db=require('./backoffice-neon');
const c=require('./backoffice-core');
const {AuthError}=require('./backoffice-neon-auth');
const ZONE='America/Sao_Paulo';
function windowFor(start,end){
 const today=c.businessDate(),to=c.isoDate(end||today),from=c.isoDate(start||today);
 const days=(Date.parse(to)-Date.parse(from))/86400000+1;
 if(days<1||days>366||to>today)c.fail('Escolha um período de até 366 dias, sem datas futuras.');
 return [from,to];
}
async function report(actor,query={}){
 if(!['admin','manager'].includes(actor.role))throw new AuthError('Relatórios exclusivos da administração.',403);
 const [from,to]=windowFor(query.start,query.end);
 const p=[from,to];
 // Two distinct cohorts: orders received and orders financially settled.
 // Revenue always uses the settled business date and actual confirmed payments.
 const bounds="created_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')";
 const paid="status='delivered' AND payment_status='paid' AND settled_business_date BETWEEN $1::date AND $2::date";
 const total="subtotal_cents+coalesce(delivery_fee_cents,0)";
 const [sales,days,methods,states,types,products,clients,operations,followup,closings,prices,coins,tabs]=await Promise.all([
 db.run("SELECT count(*)::int AS orders,coalesce(sum("+total+"),0)::bigint AS revenue_cents,coalesce(sum(subtotal_cents),0)::bigint AS products_cents,coalesce(sum(delivery_fee_cents),0)::bigint AS fees_cents,count(DISTINCT customer_id)::int AS customers FROM dp.orders WHERE "+paid,p),
 db.run("SELECT settled_business_date::text AS day,count(*)::int AS orders,sum("+total+")::bigint AS revenue_cents FROM dp.orders WHERE "+paid+" GROUP BY 1 ORDER BY 1",p),
 db.run("SELECT payment_method,count(*)::int AS orders,sum("+total+")::bigint AS revenue_cents FROM dp.orders WHERE "+paid+" GROUP BY 1 ORDER BY 3 DESC",p),
 db.run("SELECT status,count(*)::int AS orders,sum("+total+")::bigint AS order_value_cents FROM dp.orders WHERE "+bounds+" GROUP BY 1 ORDER BY 2 DESC",p),
 db.run("SELECT fulfillment->>'type' AS mode,count(*)::int AS orders,sum("+total+")::bigint AS revenue_cents FROM dp.orders WHERE "+paid+" GROUP BY 1 ORDER BY 3 DESC",p),
 db.run("SELECT i->>'product' AS product,coalesce(i->>'option','') AS variant,sum((i->>'quantity')::integer)::bigint AS quantity,sum((i->>'quantity')::integer*(i->>'cents')::bigint)::bigint AS revenue_cents FROM dp.orders CROSS JOIN LATERAL jsonb_array_elements(items) i WHERE "+paid+" GROUP BY 1,2 ORDER BY 4 DESC LIMIT 100",p),
 db.run("WITH period AS (SELECT customer_id,count(*) AS orders FROM dp.orders WHERE "+paid+" GROUP BY customer_id) SELECT count(*)::int AS buyers,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM dp.orders h WHERE h.customer_id=period.customer_id AND h.status='delivered' AND h.payment_status='paid' AND h.settled_business_date<$1::date))::int AS returning,count(*) FILTER(WHERE orders>1)::int AS repeat_in_period FROM period",p),
 db.run("SELECT count(*) FILTER(WHERE accepted_at IS NOT NULL)::int AS accepted,count(*) FILTER(WHERE telegram_state='uncertain')::int AS telegram_uncertain,count(*) FILTER(WHERE telegram_state='pending' AND origin='site')::int AS telegram_pending,count(*) FILTER(WHERE status='delivered' AND payment_status='pending')::int AS delivered_unpaid,coalesce(sum("+total+") FILTER(WHERE status='delivered' AND payment_status='pending'),0)::bigint AS unpaid_cents,round(avg(extract(epoch FROM (accepted_at-created_at))/60) FILTER(WHERE accepted_at>=created_at),1) AS avg_accept_minutes,round(avg(extract(epoch FROM (delivered_at-dispatched_at))/60) FILTER(WHERE dispatched_at IS NOT NULL AND delivered_at>=dispatched_at),1) AS avg_delivery_minutes,count(*) FILTER(WHERE dispatched_at IS NOT NULL AND delivered_at>=dispatched_at)::int AS delivery_samples FROM dp.orders WHERE "+bounds,p),
 db.run("SELECT state,count(*)::int AS tasks,count(*) FILTER(WHERE review_requested_at IS NOT NULL)::int AS review_invites,count(*) FILTER(WHERE contacted_at IS NOT NULL)::int AS contacted,count(*) FILTER(WHERE state='pending' AND due_at<=now())::int AS overdue FROM dp.after_sales WHERE due_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND due_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY state ORDER BY state",p),
 db.run("SELECT business_date::text AS day,counted_cash_cents,discrepancy_cents,summary,closed_at FROM dp.cash_closings WHERE business_date BETWEEN $1::date AND $2::date ORDER BY business_date DESC",p),
 db.run("SELECT category,product,variant,old_price,new_price,changed_at FROM dp.price_changes WHERE changed_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND changed_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') ORDER BY changed_at DESC LIMIT 100",p),
 db.run("SELECT cfg.enabled,coalesce((SELECT sum(credit_cents) FROM dp.cashback_credits WHERE earned_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND earned_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')),0)::bigint AS issued_cents FROM dp.cashback_config cfg WHERE cfg.id='opanquecao'",p),
 db.run("SELECT state,count(*)::int AS tabs,count(DISTINCT table_number)::int AS tables FROM dp.comandas WHERE opened_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND opened_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY state",p)
 ]);
 const result={period:{from,to,timezone:ZONE},sales:sales[0],days,methods,states,types,products,clients:clients[0],operations:operations[0],followup,closings,prices,tabs,coins:coins[0]||{enabled:false,issued_cents:0},limits:{products:100,prices:100},generatedAt:new Date().toISOString()};
 if(actor.role==='admin'){
  const [staff,activity,events,catalog]=await Promise.all([
   db.run("SELECT role,active,count(*)::int AS total FROM dp.staff GROUP BY role,active ORDER BY role"),
   db.run("SELECT coalesce(s.role,'system') AS role,coalesce(s.email,'Sistema/legado') AS operator,count(*)::int AS changes FROM dp.order_events e LEFT JOIN dp.staff s ON s.user_id=e.actor_id WHERE changed_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND changed_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY 1,2 ORDER BY 3 DESC",p),
   db.run("SELECT previous_status,next_status,count(*)::int AS transitions FROM dp.order_events WHERE changed_at>=($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND changed_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY 1,2 ORDER BY 3 DESC",p),
   db.run("SELECT revision,updated_at FROM dp.catalog WHERE id='opanquecao'")
  ]);
  result.technical={staff,activity,events,catalog:catalog[0],source:process.env.CATALOG_SOURCE==='neon'?'Neon':'Outra fonte'};
 }
 return result;
}
module.exports={report,windowFor};
