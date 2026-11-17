-- XTL FOOD: Blueprint only. NOT applied to any database.
-- Requires existing restaurant_catalogs table and opanquecao seed on a dedicated HML project.
-- Generate a migration filename using Supabase CLI AFTER HML project creation.
begin;
create table if not exists public.food_orders_v1 (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurant_catalogs(restaurant_id) on delete restrict,
  request_id uuid not null,
  public_ref text not null check(public_ref ~ '^[a-f0-9]{8}$'),
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  contact jsonb not null check(jsonb_typeof(contact) = 'object' and octet_length(contact::text) <= 1024),
  items jsonb not null check(jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50 and octet_length(items::text) <= 32000),
  fulfillment jsonb not null check(jsonb_typeof(fulfillment) = 'object' and octet_length(fulfillment::text) <= 4096),
  payment jsonb not null check(jsonb_typeof(payment) = 'object' and octet_length(payment::text) <= 1024),
  subtotal_cents integer not null check(subtotal_cents between 0 and 10000000),
  delivery_fee_cents integer check(delivery_fee_cents between 0 and 100000),
  status text not null default 'pending_notification'
    check(status in ('pending_notification','notification_sent','notification_unknown','confirmed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, request_id),
  unique (restaurant_id, public_ref),
  unique (restaurant_id, id)
);
create table if not exists public.food_notification_outbox_v1 (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null,
  order_id uuid not null,
  channel text not null default 'telegram' check(channel = 'telegram'),
  status text not null default 'pending'
    check(status in ('pending','processing','sent','unknown','manual_review','cancelled')),
  attempt_count smallint not null default 0 check(attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  provider_message_id bigint,
  last_error_code text check(last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (restaurant_id, order_id) references public.food_orders_v1(restaurant_id,id) on delete restrict,
  unique (restaurant_id, order_id, channel)
);
create index if not exists food_orders_v1_status_idx on public.food_orders_v1 (restaurant_id,status,created_at desc);
create index if not exists food_outbox_v1_pending_idx
  on public.food_notification_outbox_v1 (restaurant_id,next_attempt_at) where status = 'pending';
alter table public.food_orders_v1 enable row level security;
alter table public.food_notification_outbox_v1 enable row level security;
revoke all on public.food_orders_v1 from public, anon, authenticated;
revoke all on public.food_notification_outbox_v1 from public, anon, authenticated;
grant select, insert, update on public.food_orders_v1 to service_role;
grant select, insert, update on public.food_notification_outbox_v1 to service_role;

create or replace function public.xtl_food_accept_order_v1(
  p_restaurant_id text,
  p_request_id uuid,
  p_public_ref text,
  p_payload_sha256 text,
  p_contact jsonb,
  p_items jsonb,
  p_fulfillment jsonb,
  p_payment jsonb,
  p_subtotal_cents integer,
  p_delivery_fee_cents integer
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_inserted uuid;
        v_order public.food_orders_v1%rowtype;
begin
  if p_restaurant_id <> 'opanquecao' or p_request_id is null
     or substring(p_request_id::text from 15 for 1) <> '4'
     or p_public_ref !~ '^[a-f0-9]{8}$'
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_contact is null or jsonb_typeof(p_contact) <> 'object'
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or p_fulfillment is null or jsonb_typeof(p_fulfillment) <> 'object'
     or p_payment is null or jsonb_typeof(p_payment) <> 'object'
     or p_subtotal_cents is null or p_subtotal_cents < 0
     or (p_delivery_fee_cents is not null and p_delivery_fee_cents < 0)
  then raise exception 'invalid_order' using errcode = '22023'; end if;
  insert into public.food_orders_v1 (
    restaurant_id,request_id,public_ref,payload_sha256,
    contact,items,fulfillment,payment,subtotal_cents,delivery_fee_cents
  ) values (
    p_restaurant_id,p_request_id,p_public_ref,p_payload_sha256,
    p_contact,p_items,p_fulfillment,p_payment,p_subtotal_cents,p_delivery_fee_cents
  ) on conflict (restaurant_id,request_id) do nothing
  returning id into v_inserted;
  select * into v_order from public.food_orders_v1
   where restaurant_id = p_restaurant_id and request_id = p_request_id;
  if v_order.id is null then raise exception 'order_not_recorded' using errcode = 'P0001'; end if;
  if v_order.payload_sha256 <> p_payload_sha256 then
    return jsonb_build_object('outcome','conflict','status','rejected');
  end if;
  if v_inserted is not null then
    -- Order and Telegram outbox written in the same Postgres transaction.
    insert into public.food_notification_outbox_v1 (restaurant_id, order_id, channel)
    values (p_restaurant_id, v_order.id, 'telegram');
  end if;
  return jsonb_build_object(
    'outcome', case when v_inserted is not null then 'accepted' else 'replayed' end,
    'order_id',v_order.id,'public_ref',v_order.public_ref,'status',v_order.status);
end;
$$;
revoke all on function public.xtl_food_accept_order_v1(
  text,uuid,text,text,jsonb,jsonb,jsonb,jsonb,integer,integer
) from public, anon, authenticated;
grant execute on function public.xtl_food_accept_order_v1(
  text,uuid,text,text,jsonb,jsonb,jsonb,jsonb,integer,integer
) to service_role;
commit;
