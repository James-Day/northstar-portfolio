-- Source rows are immutable evidence. Import state transitions must use the
-- validated RPCs so a client cannot rewrite parsing evidence or skip review.

alter function public.stage_import(uuid, text, text, text, jsonb, date, date, integer, integer) security definer set search_path = public, extensions;
alter function public.commit_import(uuid) security definer set search_path = public, extensions;
alter function public.undo_import(uuid) security definer set search_path = public, extensions;

revoke execute on function public.commit_import_unlocked(uuid) from authenticated;

create or replace function public.discard_import(p_import_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_import public.imports%rowtype;
begin
  select i.* into v_import
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid()
  for update of i;

  if not found then return null; end if;
  if v_import.status <> 'ready_for_review' then return null; end if;

  update public.imports
  set status = 'discarded', updated_at = now()
  where id = p_import_id and status = 'ready_for_review';
  return p_import_id;
end;
$$;

revoke all on function public.discard_import(uuid) from public, anon;
grant execute on function public.discard_import(uuid) to authenticated;

revoke insert, update, delete on public.imports, public.import_source_rows from public, anon, authenticated;
grant select on public.imports, public.import_source_rows to authenticated;
