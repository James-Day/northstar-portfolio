-- The issue-resolution migration recreated the serialized commit/undo
-- wrappers after the lot-rebuild migration and accidentally dropped the
-- rebuild call. Restore the final wrapper definitions after all earlier
-- function replacements have run.

create or replace function public.commit_import(p_import_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_result uuid;
begin
  select i.account_id into v_account_id
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid();
  if not found then raise exception 'Import not found.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  perform public.validate_import_issue_resolutions(p_import_id);
  v_result := public.commit_import_unlocked(p_import_id);
  perform public.rebuild_account_lots(v_account_id);
  return v_result;
end;
$$;

create or replace function public.undo_import(p_import_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_result uuid;
begin
  select i.account_id into v_account_id
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid();
  if not found then raise exception 'Import not found.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  v_result := public.undo_import_unlocked(p_import_id);
  perform public.rebuild_account_lots(v_account_id);
  return v_result;
end;
$$;

-- This derived projection is reachable only through the ownership-checked,
-- account-serialized wrappers above.
revoke all on function public.rebuild_account_lots(uuid) from public, anon, authenticated;
revoke all on function public.commit_import_unlocked(uuid) from public, anon, authenticated;
revoke all on function public.undo_import_unlocked(uuid) from public, anon, authenticated;
revoke all on function public.commit_import(uuid) from public, anon;
grant execute on function public.commit_import(uuid) to authenticated;
revoke all on function public.undo_import(uuid) from public, anon;
grant execute on function public.undo_import(uuid) to authenticated;
