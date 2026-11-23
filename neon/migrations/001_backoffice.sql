-- Disk Panquecão: Neon/Postgres privado, com esquema dedicado e índices contidos.
-- Executar apenas em database NOVA e exclusiva do restaurante.
-- Não reutilizar XTL Core, LinkSul ou Jarbas. Nenhuma credencial no Git.
begin;
create extension if not exists pgcrypto;
create schema if not exists dp;
revoke all on schema dp from public;
create table if not exists dp.catalog (
  id text primary key check (id='opanquecao'),
  data jsonb not null check (jsonb_typeof(data)='object'),
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists dp.price_changes (
  id bigint generated always as identity primary key,
  category text not null, product text not null, variant text not null,
  old_price text, new_price text not null, actor_id text not null,
  changed_at timestamptz not null default now()
);
create table if not exists dp.staff (
  user_id text primary key, email text not null,
  role text not null check (role in ('manager','attendant')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists dp.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  phone text not null unique check (phone ~ '^[1-9][0-9]{9,10}$'),
  notes text not null default '' check (length(notes)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dp_customers_created_idx on dp.customers (created_at desc);
create index if not exists dp_customers_name_prefix_idx on dp.customers (lower(name) text_pattern_ops);
create table if not exists dp.orders (
  request_id uuid primary key,
  ref_code text not null unique check (ref_code ~ '^[A-F0-9]{8}$'),
  customer_id uuid not null references dp.customers(id),
  origin text not null default 'site' check (origin in ('site','manual')),
  status text not null default 'pending_customer' check (status in
    ('pending_customer','awaiting_acceptance','accepted','completed','delivered','cancelled')),
  telegram_state text not null default 'pending' check (telegram_state in ('pending','sent','uncertain','not_applicable')),
  items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
  fulfillment jsonb not null check (jsonb_typeof(fulfillment)='object'),
  note text not null default '' check (length(note)<=400),
  subtotal_cents integer not null check (subtotal_cents between 0 and 1000000),
  delivery_fee_cents integer check (delivery_fee_cents between 0 and 10000),
  payment_method text check (payment_method in ('cash','pix','credit','debit','other')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid')),
  paid_at timestamptz, accepted_at timestamptz, delivered_at timestamptz,
  settled_business_date date, updated_by text,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists dp_orders_recent_idx on dp.orders(created_at desc);
create index if not exists dp_orders_queue_idx on dp.orders(status,created_at desc) where status <> 'delivered' and status <> 'cancelled';
create index if not exists dp_orders_paid_idx on dp.orders(settled_business_date,payment_method)
  where status='delivered' and payment_status='paid';
create index if not exists dp_orders_customer_idx on dp.orders(customer_id, created_at desc);
create table if not exists dp.order_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references dp.orders(request_id),
  actor_id text,
  previous_status text, next_status text,
  previous_payment text, next_payment text,
  changed_at timestamptz not null default now()
);
create index if not exists dp_events_order_idx on dp.order_events(request_id,changed_at desc);
create table if not exists dp.cash_closings (
  business_date date primary key,
  summary jsonb not null default '{}'::jsonb,
  counted_cash_cents integer not null check (counted_cash_cents >= 0),
  discrepancy_cents integer not null,
  notes text not null default '' check (length(notes)<=500),
  closed_by text not null,
  closed_at timestamptz not null default now()
);
-- Checkout sandbox isolado do caixa real, jamais cadastrado como pedido pago.
create table if not exists dp.asaas_sandbox (
  id uuid primary key default gen_random_uuid(),
  provider_checkout_id text unique,
  external_ref text not null unique,
  status text not null default 'creating'
    check (status in ('creating','active','paid','expired','canceled','uncertain')),
  amount_cents integer not null check (amount_cents between 100 and 20000),
  created_by text not null,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
create table if not exists dp.asaas_events (
  event_id text primary key,
  provider_checkout_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now()
);
create or replace function dp.order_lock() returns trigger language plpgsql
set search_path='' as $$
declare date_key date;
begin
  if tg_op='UPDATE' then
    if old.settled_business_date is not null and
      (old.subtotal_cents,old.delivery_fee_cents,old.payment_status,old.payment_method,old.status)
       is distinct from
      (new.subtotal_cents,new.delivery_fee_cents,new.payment_status,new.payment_method,new.status) then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(old.settled_business_date::text));
      if exists(select 1 from dp.cash_closings where business_date=old.settled_business_date)
        then raise exception 'Caixa fechado - conciliacao manual obrigatoria';end if;
    end if;
  end if;
  if new.status='delivered' and new.payment_status='paid' then
    if new.fulfillment->>'type'='delivery' and new.delivery_fee_cents is null then
      raise exception 'Taxa de entrega pendente';end if;
    if new.payment_method is null then raise exception 'Forma de pagamento pendente';end if;
    if new.settled_business_date is null then
      date_key := (now() at time zone 'America/Sao_Paulo')::date;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(date_key::text));
      if exists(select 1 from dp.cash_closings where business_date=date_key) then
        raise exception 'Caixa do dia fechado';end if;
      new.settled_business_date := date_key;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dp_guard on dp.orders;
create trigger dp_guard before update on dp.orders for each row execute function dp.order_lock();
create or replace function dp.order_audit() returns trigger language plpgsql set search_path='' as $$
begin
  if (old.status,old.payment_status,old.payment_method,old.delivery_fee_cents)
    is distinct from (new.status,new.payment_status,new.payment_method,new.delivery_fee_cents) then
    insert into dp.order_events(request_id,actor_id,previous_status,next_status,previous_payment,next_payment)
    values(new.request_id,new.updated_by,old.status,new.status,old.payment_status,new.payment_status);
  end if;
  return new;
end $$;
drop trigger if exists dp_audit on dp.orders;
create trigger dp_audit after update on dp.orders for each row execute function dp.order_audit();

-- Um único ponto de fechamento transacional: total recalculado no PostgreSQL.
create or replace function dp.close_cash(p_date date,p_counted integer,p_notes text,p_actor text)
returns jsonb language plpgsql set search_path='' as $$
declare totals jsonb; cash_value bigint;
begin
  if p_date is distinct from (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Fechamento apenas no dia atual';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_date::text));
  if exists(select 1 from dp.cash_closings where business_date=p_date) then
    raise exception 'Caixa ja encerrado';end if;
  select jsonb_build_object('orders',count(*),'total_cents',coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)),0),
     'cash_cents',coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method='cash'),0),
     'pix_cents',coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method='pix'),0),
     'credit_cents',coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method='credit'),0),
     'debit_cents',coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method='debit'),0),
     'other_cents',coalesce(sum(subtotal_cents+coalesce(delivery_fee_cents,0)) filter(where payment_method='other'),0))
   into totals from dp.orders where settled_business_date=p_date and status='delivered' and payment_status='paid';
  cash_value := (totals->>'cash_cents')::bigint;
  insert into dp.cash_closings(business_date,summary,counted_cash_cents,discrepancy_cents,notes,closed_by)
  values(p_date,totals,p_counted,p_counted-cash_value,p_notes,p_actor);
  return totals;
end $$;
revoke all on function dp.close_cash(date,integer,text,text) from public;
commit;
