-- XTL shared LAB. Each authenticated gateway call consumes exactly one nonce.
begin;
create table if not exists public.xtl_food_gateway_nonces (
  nonce_sha256 text primary key check (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  restaurant_id text not null references public.xtl_food_restaurant_bindings(restaurant_id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint xtl_food_gateway_nonce_expiration_check check (expires_at > created_at)
);
create index if not exists xtl_food_gateway_nonce_expiry_idx on public.xtl_food_gateway_nonces(expires_at);
alter table public.xtl_food_gateway_nonces enable row level security;
revoke all on public.xtl_food_gateway_nonces from public,anon,authenticated,xtl_food_runtime;
grant select,insert,delete on public.xtl_food_gateway_nonces to service_role;
commit;
