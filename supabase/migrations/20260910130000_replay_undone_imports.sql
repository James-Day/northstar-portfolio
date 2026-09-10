-- An undone import remains immutable for audit and report replay, but it must
-- not make a statement permanently non-replayable. The partial uniqueness
-- rule still prevents duplicate active staging/commits, including concurrent
-- requests that race past the API preflight query.
alter table public.imports
  drop constraint if exists imports_account_id_file_sha256_key;

create unique index if not exists imports_active_file_hash_unique
  on public.imports(account_id, file_sha256)
  where status not in ('discarded', 'undone');

-- Fingerprints are used only to detect activities that are already part of the
-- active account ledger. Keep the undone ledger rows for audit, while removing
-- their deduplication identity so a later replay can create active entries.
update public.ledger_entries l
set fingerprint = null
where l.import_id in (select i.id from public.imports i where i.status = 'undone');

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

  delete from public.lots l
  using public.ledger_entries e
  where l.opening_entry_id = e.id and e.import_id = p_import_id;

  -- Preserve the ledger rows and source records, but remove their active
  -- duplicate identity. Reports must filter by import status when replaying.
  update public.ledger_entries
  set fingerprint = null
  where import_id = p_import_id;

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
