-- Applied to XTL shared LAB (oksafggcaotekrvwvqgg) via Supabase MCP.
-- Cover missing Food/tenant FKs. Non-destructive; no existing indexes dropped.
begin;
create index if not exists food_operations_audit_restaurant_idx on public.restaurant_operations_audit (restaurant_id);
create index if not exists xtl_food_bindings_company_account_idx on public.xtl_food_restaurant_bindings (company_id,account_id);
create index if not exists xtl_food_bindings_account_project_idx on public.xtl_food_restaurant_bindings (account_id,project_id);
create index if not exists xtl_projects_company_account_idx on public.xtl_projects (company_id,account_id);
commit;
