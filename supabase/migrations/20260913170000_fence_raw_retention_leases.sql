-- Fence raw-file retention completion and failure updates to the claim that
-- produced them. A worker may finish after its lease is reclaimed; its late
-- response must not complete or reschedule the newer attempt.
create or replace function public.complete_raw_file_retention(
  p_id uuid,
  p_attempts integer,
  p_deleted_at timestamptz default now()
)
returns void language plpgsql security definer set search_path = public
as $$
declare v_row public.raw_file_retention%rowtype;
begin
  select * into v_row from public.raw_file_retention
  where id = p_id and status = 'deleting' and attempts = p_attempts for update;
  if not found then return; end if;
  update public.raw_file_retention
  set status = 'deleted', deleted_at = p_deleted_at, claimed_at = null,
      last_error = null, updated_at = p_deleted_at
  where id = p_id and status = 'deleting' and attempts = p_attempts;
  insert into public.raw_file_retention_audit (retention_id, import_id, attempt, event_type, occurred_at)
  values (p_id, v_row.import_id, v_row.attempts, 'deleted', p_deleted_at);
end;
$$;

create or replace function public.fail_raw_file_retention(
  p_id uuid,
  p_attempts integer,
  p_failed_at timestamptz,
  p_available_at timestamptz,
  p_error text,
  p_max_attempts integer default 8
)
returns text language plpgsql security definer set search_path = public
as $$
declare v_row public.raw_file_retention%rowtype; v_status text;
begin
  select * into v_row from public.raw_file_retention
  where id = p_id and status = 'deleting' and attempts = p_attempts for update;
  if not found then return 'retrying'; end if;
  if v_row.attempts >= greatest(1, p_max_attempts) then
    v_status := 'exhausted';
    update public.raw_file_retention set status = 'exhausted', claimed_at = null,
      last_error = left(p_error, 1000), updated_at = p_failed_at
      where id = p_id and attempts = p_attempts;
  else
    v_status := 'retrying';
    update public.raw_file_retention set status = 'pending', available_at = p_available_at,
      claimed_at = null, last_error = left(p_error, 1000), updated_at = p_failed_at
      where id = p_id and attempts = p_attempts;
  end if;
  insert into public.raw_file_retention_audit (retention_id, import_id, attempt, event_type, error_message, occurred_at)
  values (p_id, v_row.import_id, v_row.attempts,
    case when v_status = 'exhausted' then 'exhausted' else 'failed' end,
    left(p_error, 1000), p_failed_at);
  return v_status;
end;
$$;

revoke all on function public.complete_raw_file_retention(uuid, integer, timestamptz) from public;
revoke all on function public.fail_raw_file_retention(uuid, integer, timestamptz, timestamptz, text, integer) from public;
grant execute on function public.complete_raw_file_retention(uuid, integer, timestamptz) to service_role;
grant execute on function public.fail_raw_file_retention(uuid, integer, timestamptz, timestamptz, text, integer) to service_role;
