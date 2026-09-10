-- Keep activity coverage derived from committed imports. This is deliberately
-- separate from market-price freshness and is recomputed after commit/undo.
create or replace function public.refresh_account_activity_coverage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts a
  set activity_covered_through = (
    select max(i.activity_through)
    from public.imports i
  where i.account_id = case when TG_OP = 'DELETE' then old.account_id else new.account_id end
      and i.status = 'committed'
  ), updated_at = now()
  where a.id = case when TG_OP = 'DELETE' then old.account_id else new.account_id end;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists imports_refresh_activity_coverage on public.imports;
create trigger imports_refresh_activity_coverage
after insert or update of status, activity_through or delete on public.imports
for each row execute function public.refresh_account_activity_coverage();

revoke all on function public.refresh_account_activity_coverage() from public;
