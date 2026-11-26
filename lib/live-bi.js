'use strict';
// Single bounded aggregate query per refresh. No customer identifiers or credentials.
const db=require('./backoffice-neon');
const {AuthError}=require('./backoffice-neon-auth');
const SQL=`WITH clock AS (
 SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS day
), sales AS (
 SELECT o.* FROM dp.orders o,clock c WHERE status='delivered' AND payment_status='paid'
 AND settled_business_date BETWEEN c.day-6 AND c.day
), today_sales AS (
 SELECT s.* FROM sales s,clock c WHERE s.settled_business_date=c.day
), incoming AS (
 SELECT o.* FROM dp.orders o,clock c WHERE created_at >= (c.day::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND created_at < ((c.day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
), totals AS (
 SELECT count(*)::int AS orders,coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)),0)::bigint AS revenue_cents,
 count(DISTINCT customer_id)::int AS customers FROM today_sales
), daily AS (
 SELECT d::date AS day,count(s.request_id)::int AS orders,coalesce(sum(s.subtotal_cents+coalesce(s.delivery_fee_cents,0)),0)::bigint AS revenue_cents
 FROM clock c CROSS JOIN LATERAL generate_series(c.day-6,c.day,interval '1 day') d
 LEFT JOIN sales s ON s.settled_business_date=d::date GROUP BY d ORDER BY d
), queue AS (
 SELECT status,count(*)::int AS orders FROM dp.orders WHERE status IN ('pending_customer','awaiting_acceptance','accepted','preparing','returned_to_attendant','completed','out_for_delivery') GROUP BY status
), methods AS (
 SELECT payment_method AS method,count(*)::int AS orders,sum(subtotal_cents+coalesce(delivery_fee_cents,0))::bigint AS revenue_cents FROM today_sales GROUP BY 1
), products AS (
 SELECT i->>'product' AS product,sum((i->>'quantity')::int)::int AS quantity FROM today_sales CROSS JOIN LATERAL jsonb_array_elements(items) i GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 5
), followup AS (
 SELECT count(*) FILTER (WHERE state='pending' AND due_at<=now())::int AS due,
 count(*) FILTER (WHERE state='issue')::int AS issues FROM dp.after_sales WHERE state IN ('pending','issue')
), timing AS (
 SELECT count(*)::int AS received,count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
 round(avg(extract(epoch FROM (accepted_at-created_at))/60) FILTER(WHERE accepted_at>=created_at),1) AS accept_minutes,
 round(avg(extract(epoch FROM (delivered_at-dispatched_at))/60) FILTER(WHERE dispatched_at IS NOT NULL AND delivered_at>=dispatched_at),1) AS delivery_minutes
 FROM incoming
)
SELECT c.day::text AS day,now() AS generated_at,to_jsonb(t) AS totals,to_jsonb(f) AS followup,to_jsonb(m) AS timing,
 coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily d),'[]'::jsonb) AS daily,
 coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.status) FROM queue q),'[]'::jsonb) AS queue,
 coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.revenue_cents DESC) FROM methods p),'[]'::jsonb) AS methods,
 coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.quantity DESC,p.product) FROM products p),'[]'::jsonb) AS products,
 EXISTS(SELECT 1 FROM dp.cash_closings WHERE business_date=c.day) AS cash_closed
 FROM clock c CROSS JOIN totals t CROSS JOIN followup f CROSS JOIN timing m`;
async function live(actor){
 if(!['admin','manager'].includes(actor.role))throw new AuthError('BI exclusivo dos proprietários e superadministrador.',403);
 const rows=await db.run(SQL);
 if(!rows[0])throw new db.StoreError('Indicadores indisponíveis.');
 return rows[0];
}
module.exports={live,SQL};
