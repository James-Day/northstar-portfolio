-- Service-only, transactional cleanup for one account deletion-plan item.
-- Delete dependent projections and imports before the account because several
-- MVP foreign keys intentionally use RESTRICT to protect normal user edits.
create or replace function public.delete_user_account_data(p_user_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.accounts where id = p_account_id and user_id = p_user_id) then
    return;
  end if;
  delete from public.import_issue_resolutions where import_id in (select id from public.imports where account_id = p_account_id);
  delete from public.lots where account_id = p_account_id;
  delete from public.ledger_entries where account_id = p_account_id;
  delete from public.imports where account_id = p_account_id;
  delete from public.accounts where id = p_account_id and user_id = p_user_id;
end;
$$;
revoke all on function public.delete_user_account_data(uuid, uuid) from public;
grant execute on function public.delete_user_account_data(uuid, uuid) to service_role;
