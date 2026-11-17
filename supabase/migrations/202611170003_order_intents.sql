-- XTL Food: ledger minimalista para idempotência de pré-pedidos.
-- Executar SOMENTE após as migrações de catálogo, no Supabase dedicado ao restaurante.
-- Nunca executar em XTL Core/ID, Jarbas ou LinkSul.
begin;
create table if not exists public.restaurant_order_intents (
  restaurant_id text not null references public.restaurant_catalogs(restaurant_id) on delete restrict,
  request_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  order_ref text not null check (order_ref ~ '^[a-f0-9]{8}$'),
  status text not null default 'processing'
    check (status in ('processing', 'delivered', 'needs_review')),
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, request_id)
);
create index if not exists restaurant_order_intents_status_idx
  on public.restaurant_order_intents (restaurant_id, status, created_at);
alter table public.restaurant_order_intents enable row level security;
-- Sem política pública: somente credencial de servidor, fora do navegador.
revoke all on public.restaurant_order_intents from public, anon, authenticated;
commit;
