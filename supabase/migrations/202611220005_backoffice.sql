-- Disk Panquecão / XTL TECH - Backoffice inicial (aplicar somente em Supabase dedicado).
-- Pré-requisito: 202611170001..004, com restaurant_catalogs('opanquecao').
-- Sem usuários de demonstração ou contas pré-configuradas. Administração via Auth.
begin;

create table if not exists public.restaurant_staff (
  restaurant_id text not null references public.restaurant_catalogs(restaurant_id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('manager','attendant')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create table if not exists public.restaurant_customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurant_catalogs(restaurant_id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 80),
  phone text not null check (phone ~ '^[1-9][0-9]{9,10}$'),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, phone),
  unique (restaurant_id, id)
);
create index if not exists restaurant_customers_name_idx
  on public.restaurant_customers (restaurant_id, name);

create table if not exists public.restaurant_orders (
  restaurant_id text not null references public.restaurant_catalogs(restaurant_id) on delete restrict,
  request_id uuid not null,
  ref_code text not null check (ref_code ~ '^[A-F0-9]{8}$'),
  customer_id uuid not null,
  origin text not null default 'site' check (origin in ('site','manual')),
  status text not null default 'pending_customer'
    check (status in ('pending_customer','awaiting_acceptance','accepted','completed','delivered','cancelled')),
  telegram_state text not null default 'pending'
    check (telegram_state in ('pending','sent','uncertain','not_applicable')),
  items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) >= 1),
  fulfillment jsonb not null check (jsonb_typeof(fulfillment)='object'),
  note text not null default '' check (length(note) <= 400),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer check (delivery_fee_cents between 0 and 10000),
  payment_method text check (payment_method in ('cash','pix','credit','debit','other')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid')),
  paid_at timestamptz,
  settled_business_date date,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  updated_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, request_id),
  unique (restaurant_id, ref_code),
  foreign key (restaurant_id, customer_id)
    references public.restaurant_customers(restaurant_id,id) on delete restrict
);
create index if not exists restaurant_orders_queue_idx
  on public.restaurant_orders (restaurant_id,status,created_at desc);
create index if not exists restaurant_orders_cash_idx
  on public.restaurant_orders (restaurant_id,settled_business_date,payment_method)
  where payment_status='paid' and status='delivered';

create table if not exists public.restaurant_order_events (
  event_id bigint generated always as identity primary key,
  restaurant_id text not null,
  request_id uuid not null,
  actor_id uuid,
  old_values jsonb not null,
  new_values jsonb not null,
  changed_at timestamptz not null default now(),
  foreign key (restaurant_id,request_id)
    references public.restaurant_orders(restaurant_id,request_id) on delete restrict
);
create index if not exists restaurant_order_events_ref_idx
 on public.restaurant_order_events(restaurant_id,request_id,changed_at desc);

create table if not exists public.restaurant_cash_closings (
  restaurant_id text not null references public.restaurant_catalogs(restaurant_id) on delete restrict,
  business_date date not null,
  summary jsonb not null default '{}'::jsonb,
  counted_cash_cents integer not null check (counted_cash_cents >= 0),
  discrepancy_cents integer not null default 0,
  notes text not null default '' check (length(notes) <= 500),
  closed_by uuid not null references auth.users(id),
  closed_at timestamptz not null default now(),
  primary key (restaurant_id,business_date)
);

-- Todas as tabelas com dados operacionais são privadas: SOMENTE backend com
-- SUPABASE_SECRET_KEY; nunca usar credenciais de serviço no navegador.
alter table public.restaurant_staff enable row level security;
alter table public.restaurant_customers enable row level security;
alter table public.restaurant_orders enable row level security;
alter table public.restaurant_order_events enable row level security;
alter table public.restaurant_cash_closings enable row level security;
revoke all on public.restaurant_staff from public,anon,authenticated;
revoke all on public.restaurant_customers from public,anon,authenticated;
revoke all on public.restaurant_orders from public,anon,authenticated;
revoke all on public.restaurant_order_events from public,anon,authenticated;
revoke all on public.restaurant_cash_closings from public,anon,authenticated;
grant select,insert,update on public.restaurant_staff to service_role;
grant select,insert,update on public.restaurant_customers to service_role;
grant select,insert,update on public.restaurant_orders to service_role;
grant select,insert on public.restaurant_order_events to service_role;
grant select,insert on public.restaurant_cash_closings to service_role;
grant usage,select on sequence public.restaurant_order_events_event_id_seq to service_role;

-- Lock curto por dia para serializar liquidações e fechamento.
-- Impede contabilizar pedido após encerramento do respectivo dia.
create or replace function public.restaurant_order_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_date date;
begin
  if tg_op='UPDATE' then
    if old.settled_business_date is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(old.restaurant_id||':'||old.settled_business_date::text));
      if exists (select 1 from public.restaurant_cash_closings c
                 where c.restaurant_id=old.restaurant_id and c.business_date=old.settled_business_date) then
        raise exception 'Dia já fechado; ajuste financeiro exige reconciliação' using errcode='23514';
      end if;
    end if;
  end if;
  if new.status='delivered' and new.payment_status='paid' and new.settled_business_date is null then
    v_date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.restaurant_id||':'||v_date::text));
    if exists (select 1 from public.restaurant_cash_closings c
               where c.restaurant_id=new.restaurant_id and c.business_date=v_date) then
      raise exception 'Caixa do dia já encerrado' using errcode='23514';
    end if;
    new.settled_business_date := v_date;
  end if;
  if new.status='delivered' and new.payment_status='paid' and new.payment_method is null then
    raise exception 'Forma de pagamento obrigatória para liquidação' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_restaurant_order_guard on public.restaurant_orders;
create trigger trg_restaurant_order_guard before insert or update on public.restaurant_orders
for each row execute function public.restaurant_order_guard();

create or replace function public.restaurant_order_audit()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.restaurant_order_events(restaurant_id,request_id,actor_id,old_values,new_values)
  values(new.restaurant_id,new.request_id,new.updated_by,
    jsonb_build_object('status',old.status,'payment_status',old.payment_status,
                       'payment_method',old.payment_method,'delivery_fee_cents',old.delivery_fee_cents),
    jsonb_build_object('status',new.status,'payment_status',new.payment_status,
                       'payment_method',new.payment_method,'delivery_fee_cents',new.delivery_fee_cents));
  return new;
end;
$$;
drop trigger if exists trg_restaurant_order_audit on public.restaurant_orders;
create trigger trg_restaurant_order_audit after update on public.restaurant_orders
for each row when (old.* is distinct from new.*)
execute function public.restaurant_order_audit();

-- Fecha SOMENTE o valor efetivamente pago + entregue. O trigger calcula
-- no banco, não aceita totais enviados pelo navegador.
create or replace function public.restaurant_cash_closing_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_count integer; v_total bigint; v_cash bigint; v_pix bigint;
        v_credit bigint; v_debit bigint; v_other bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.restaurant_id||':'||new.business_date::text));
  if new.business_date <> (pg_catalog.now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Fechamento somente do dia atual' using errcode='23514';
  end if;
  select count(*),coalesce(sum(o.subtotal_cents+coalesce(o.delivery_fee_cents,0)),0),
    coalesce(sum(o.subtotal_cents+coalesce(o.delivery_fee_cents,0)) filter (where o.payment_method='cash'),0),
    coalesce(sum(o.subtotal_cents+coalesce(o.delivery_fee_cents,0)) filter (where o.payment_method='pix'),0),
    coalesce(sum(o.subtotal_cents+coalesce(o.delivery_fee_cents,0)) filter (where o.payment_method='credit'),0),
    coalesce(sum(o.subtotal_cents+coalesce(o.delivery_fee_cents,0)) filter (where o.payment_method='debit'),0),
    coalesce(sum(o.subtotal_cents+coalesce(o.delivery_fee_cents,0)) filter (where o.payment_method='other'),0)
   into v_count,v_total,v_cash,v_pix,v_credit,v_debit,v_other
   from public.restaurant_orders o
   where o.restaurant_id=new.restaurant_id and o.settled_business_date=new.business_date
    and o.payment_status='paid' and o.status='delivered';
  new.summary := jsonb_build_object(
     'orders',v_count,'total_cents',v_total,'cash_cents',v_cash,
     'pix_cents',v_pix,'credit_cents',v_credit,'debit_cents',v_debit,'other_cents',v_other);
  new.discrepancy_cents := new.counted_cash_cents-v_cash;
  return new;
end;
$$;
drop trigger if exists trg_restaurant_cash_closing_guard on public.restaurant_cash_closings;
create trigger trg_restaurant_cash_closing_guard before insert on public.restaurant_cash_closings
for each row execute function public.restaurant_cash_closing_guard();

-- A execução de triggers não precisa estar disponível via RPC pública.
revoke all on function public.restaurant_order_guard() from public,anon,authenticated;
revoke all on function public.restaurant_order_audit() from public,anon,authenticated;
revoke all on function public.restaurant_cash_closing_guard() from public,anon,authenticated;
commit;
