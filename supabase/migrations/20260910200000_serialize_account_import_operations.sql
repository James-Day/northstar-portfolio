-- Serialize import mutations at the account boundary. Import commits and
-- undos touch account-wide projections (ledger entries, lots, fingerprints,
-- and outbox events), so locking only the individual import row still allows
-- two operations for different imports in the same account to interleave.
--
-- PostgreSQL advisory locks are transaction-scoped. A deterministic hash of
-- the account UUID gives every commit/undo for that account one lock while
-- allowing unrelated accounts to proceed concurrently. hash collisions can
-- only add serialization; they cannot permit an unsafe interleave.

alter function public.commit_import(uuid) rename to commit_import_unlocked;
alter function public.undo_import(uuid) rename to undo_import_unlocked;

create or replace function public.commit_import(p_import_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
begin
  select i.account_id into v_account_id
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid();

  if not found then
    raise exception 'Import not found.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  return public.commit_import_unlocked(p_import_id);
end;
$$;

create or replace function public.undo_import(p_import_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
begin
  select i.account_id into v_account_id
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid();

  if not found then
    raise exception 'Import not found.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  return public.undo_import_unlocked(p_import_id);
end;
$$;

-- Keep the implementation functions callable only through the authenticated
-- RPC boundary. They retain the original ownership and authorization checks;
-- these grants also allow the wrapper to invoke them under the caller role.
revoke all on function public.commit_import_unlocked(uuid) from public;
grant execute on function public.commit_import_unlocked(uuid) to authenticated;
revoke all on function public.undo_import_unlocked(uuid) from public;
grant execute on function public.undo_import_unlocked(uuid) to authenticated;

revoke all on function public.commit_import(uuid) from public;
grant execute on function public.commit_import(uuid) to authenticated;
revoke all on function public.undo_import(uuid) from public;
grant execute on function public.undo_import(uuid) to authenticated;
