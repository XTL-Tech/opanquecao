-- Migration aditiva, EXCLUSIVAMENTE no projeto dedicado Disk Panquecão.
-- Não ativar STORE_HOURS_MODE antes de configurar horários reais.
begin;
alter table public.restaurant_operations
  add column if not exists manual_state text not null default 'auto'
    check (manual_state in ('auto','open','closed')),
  add column if not exists manual_override_until timestamptz,
  add column if not exists manual_changed_by text;
alter table public.restaurant_operations
  add constraint restaurant_operations_override_expiry_check
  check (manual_state='auto' or manual_override_until is not null);
create table if not exists public.restaurant_operations_audit (
  id bigint generated always as identity primary key,
  restaurant_id text not null,
  old_values jsonb not null,
  new_values jsonb not null,
  changed_at timestamptz not null default now()
);
alter table public.restaurant_operations_audit enable row level security;
revoke all on public.restaurant_operations_audit from public,anon,authenticated;
create or replace function public.restaurant_operations_audit_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.restaurant_operations_audit(restaurant_id,old_values,new_values)
    values (new.restaurant_id, to_jsonb(old),to_jsonb(new));
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_restaurant_operations_audit on public.restaurant_operations;
create trigger trg_restaurant_operations_audit
before update on public.restaurant_operations
for each row execute function public.restaurant_operations_audit_trigger();
commit;
