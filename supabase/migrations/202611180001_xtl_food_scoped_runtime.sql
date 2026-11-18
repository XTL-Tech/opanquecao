-- Applied by Supabase MCP on 2026-11-17 in XTL shared LAB project oksafggcaotekrvwvqgg.
-- The role is NOLOGIN. This file records exact migration for review/recovery.
begin;
do $block$
begin
  if not exists(select 1 from pg_roles where rolname='xtl_food_runtime') then
    create role xtl_food_runtime nologin nobypassrls;
  elsif exists(select 1 from pg_roles where rolname='xtl_food_runtime' and
    (rolcanlogin or rolbypassrls or rolsuper)) then
    raise exception 'Existing food runtime role has unsafe privileges';
  end if;
end $block$;
grant usage on schema public to xtl_food_runtime;
grant select on public.restaurant_catalogs,public.restaurant_operations,
  public.restaurant_order_intents,public.restaurant_preorder_reviews to xtl_food_runtime;
grant insert on public.restaurant_order_intents,public.restaurant_preorder_reviews to xtl_food_runtime;
grant update(status,telegram_message_id,updated_at)
  on public.restaurant_order_intents to xtl_food_runtime;
grant update(status,rejection_reason,telegram_message_id,reviewed_by,reviewed_at,updated_at)
  on public.restaurant_preorder_reviews to xtl_food_runtime;
create policy food_runtime_catalog_read on public.restaurant_catalogs
  for select to xtl_food_runtime using (restaurant_id='opanquecao');
create policy food_runtime_hours_read on public.restaurant_operations
  for select to xtl_food_runtime using (restaurant_id='opanquecao');
create policy food_runtime_ledger_read on public.restaurant_order_intents
  for select to xtl_food_runtime using (restaurant_id='opanquecao');
create policy food_runtime_ledger_insert on public.restaurant_order_intents
  for insert to xtl_food_runtime with check (restaurant_id='opanquecao' and status='processing');
create policy food_runtime_ledger_finish on public.restaurant_order_intents
  for update to xtl_food_runtime using (restaurant_id='opanquecao' and status='processing')
  with check (restaurant_id='opanquecao' and status in ('delivered','needs_review'));
create policy food_runtime_review_read on public.restaurant_preorder_reviews
  for select to xtl_food_runtime using (restaurant_id='opanquecao');
create policy food_runtime_review_create on public.restaurant_preorder_reviews
  for insert to xtl_food_runtime
  with check (restaurant_id='opanquecao' and status='pending_review' and
    telegram_message_id is null and reviewed_by is null and reviewed_at is null);
create policy food_runtime_review_decide on public.restaurant_preorder_reviews
  for update to xtl_food_runtime using (restaurant_id='opanquecao' and status='pending_review')
  with check (restaurant_id='opanquecao' and status in
    ('pending_review','approved','rejected','delivery_uncertain'));
alter table public.restaurant_preorder_reviews add constraint food_review_terminal_decision_complete_chk
  check (status not in ('approved','rejected') or
    (telegram_message_id is not null and reviewed_by is not null and reviewed_at is not null));
commit;
