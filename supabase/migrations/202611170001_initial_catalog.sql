-- XTL Food / Disk Panquecao
-- Executar somente em projeto Supabase EXCLUSIVO do restaurante.
-- O esquema preserva integralmente o formato JSON original do cardápio.
begin;
create table if not exists public.restaurant_catalogs (
  restaurant_id text primary key check (restaurant_id ~ '^[a-z0-9-]{3,60}$'),
  catalog jsonb not null check (jsonb_typeof(catalog) = 'object' and jsonb_typeof(catalog->'categorias') = 'array'),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);
create table if not exists public.restaurant_catalog_history (
  restaurant_id text not null,
  revision bigint not null,
  previous_catalog jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (restaurant_id,revision)
);
create or replace function public.restaurant_catalog_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.restaurant_catalog_history (restaurant_id,revision,previous_catalog)
  values (old.restaurant_id,old.revision,old.catalog);
  new.revision = old.revision + 1;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_restaurant_catalog_audit on public.restaurant_catalogs;
create trigger trg_restaurant_catalog_audit
before update on public.restaurant_catalogs
for each row execute function public.restaurant_catalog_audit();

create table if not exists public.restaurant_operations (
  restaurant_id text primary key references public.restaurant_catalogs(restaurant_id) on delete restrict,
  time_zone text not null default 'America/Sao_Paulo',
  accepting_orders boolean not null default true,
  enforce_opening_hours boolean not null default false,
  -- Sem horas inventadas: administração deve configurar antes de ativar enforcement.
  weekly_schedule jsonb not null default '{}'::jsonb,
  holiday_exceptions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- RLS sempre ativa: visitantes leem apenas o catálogo público, nunca administram.
alter table public.restaurant_catalogs enable row level security;
alter table public.restaurant_catalog_history enable row level security;
alter table public.restaurant_operations enable row level security;
drop policy if exists catalog_public_read on public.restaurant_catalogs;
create policy catalog_public_read on public.restaurant_catalogs
  for select to anon,authenticated using (restaurant_id='opanquecao');
-- Não conceder write a anon/authenticated: backoffice usa endpoint
-- autenticado no servidor e credencial própria nunca exposta ao navegador.
revoke all on public.restaurant_catalogs from anon,authenticated;
revoke all on public.restaurant_catalog_history from anon,authenticated;
revoke all on public.restaurant_operations from anon,authenticated;
grant select on public.restaurant_catalogs to anon,authenticated;
commit;
