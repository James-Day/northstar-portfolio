create or replace function public.undo_import(p_import_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.imports%rowtype;
begin
  select i.* into v_import
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid()
  for update of i;

  if not found then
    raise exception 'Import not found.' using errcode = '42501';
  end if;
  if v_import.status <> 'committed' then
    raise exception 'Only committed imports can be undone.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.imports later_import
    where later_import.account_id = v_import.account_id
      and later_import.status = 'committed'
      and later_import.committed_at > v_import.committed_at
  ) then
    raise exception 'Undo the most recently committed import first.' using errcode = '22023';
  end if;

  -- Lots are a derived projection. Removing only the lots opened by this latest
  -- import leaves immutable ledger/source records for audit and replays reports
  -- from the remaining committed imports.
  delete from public.lots l
  using public.ledger_entries e
  where l.opening_entry_id = e.id and e.import_id = p_import_id;

  update public.imports
  set status = 'undone', undone_at = now(), updated_at = now()
  where id = p_import_id;
  insert into public.job_outbox (event_type, payload)
  values ('import.undone', jsonb_build_object('importId', p_import_id, 'accountId', v_import.account_id));
  return p_import_id;
end;
$$;

revoke all on function public.undo_import(uuid) from public;
grant execute on function public.undo_import(uuid) to authenticated;
