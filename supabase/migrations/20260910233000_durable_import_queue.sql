-- Durable import consumer checkpoints and queue rejection evidence.
alter table public.imports
  add column if not exists processing_attempts integer not null default 0 check (processing_attempts >= 0),
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_updated_at timestamptz,
  add column if not exists processing_rows integer not null default 0 check (processing_rows >= 0),
  add column if not exists processing_error text,
  add column if not exists processing_failed_at timestamptz;

create table if not exists public.queue_rejections (
  id uuid primary key default gen_random_uuid(),
  queue_name text not null,
  payload jsonb not null,
  reason text not null,
  attempts integer not null default 0 check (attempts >= 0),
  status text not null default 'dead_lettered' check (status in ('dead_lettered', 'replayed')),
  created_at timestamptz not null default now(),
  replayed_at timestamptz
);
create index if not exists queue_rejections_created_idx on public.queue_rejections(created_at desc);
revoke all on public.queue_rejections from public, anon, authenticated;

create or replace function public.claim_import_processing(p_import_id uuid, p_account_id uuid, p_requested_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_import public.imports%rowtype; v_total integer;
begin
  select i.* into v_import from public.imports i join public.accounts a on a.id = i.account_id
    where i.id = p_import_id and i.account_id = p_account_id and a.user_id = p_requested_by for update;
  if not found then return null; end if;
  if v_import.status in ('committed', 'discarded', 'undone') then return jsonb_build_object('state', 'already_complete'); end if;
  if v_import.status not in ('staged', 'processing', 'failed', 'ready_for_review') then raise exception 'Import is not processable.' using errcode = '22023'; end if;
  select count(*) into v_total from public.import_source_rows where import_id = p_import_id;
  update public.imports set status = 'processing', processing_attempts = processing_attempts + 1,
    processing_started_at = coalesce(processing_started_at, now()), processing_updated_at = now(),
    processing_error = null, processing_failed_at = null, processing_rows = least(processing_rows, v_total), updated_at = now()
    where id = p_import_id;
  return jsonb_build_object('import_id', p_import_id, 'account_id', p_account_id,
    'attempt', v_import.processing_attempts + 1, 'total_rows', v_total, 'progress_rows', least(v_import.processing_rows, v_total));
end; $$;

create or replace function public.advance_import_processing(p_import_id uuid, p_account_id uuid, p_progress_rows integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_total integer;
begin
  if p_progress_rows < 0 then raise exception 'Progress cannot be negative.' using errcode = '22023'; end if;
  select count(*) into v_total from public.import_source_rows where import_id = p_import_id;
  update public.imports set processing_rows = least(p_progress_rows, v_total), processing_updated_at = now(), updated_at = now()
    where id = p_import_id and account_id = p_account_id and status = 'processing';
  if not found then raise exception 'Import processing lease is no longer active.' using errcode = '40001'; end if;
end; $$;

create or replace function public.complete_import_processing(p_import_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.imports set status = 'ready_for_review', processing_updated_at = now(), processing_error = null, updated_at = now()
    where id = p_import_id and account_id = p_account_id and status = 'processing';
  if not found then raise exception 'Import processing lease is no longer active.' using errcode = '40001'; end if;
end; $$;

create or replace function public.fail_import_processing(p_import_id uuid, p_account_id uuid, p_error text, p_max_attempts integer default 5)
returns text language plpgsql security definer set search_path = public as $$
declare v_attempts integer;
begin
  select processing_attempts into v_attempts from public.imports where id = p_import_id and account_id = p_account_id and status = 'processing' for update;
  if not found then return 'dead_lettered'; end if;
  if v_attempts >= greatest(1, p_max_attempts) then
    update public.imports set status = 'failed', processing_error = left(p_error, 1000), processing_failed_at = now(), processing_updated_at = now(), updated_at = now() where id = p_import_id;
    insert into public.queue_rejections(queue_name, payload, reason, attempts) values ('northstar-imports', jsonb_build_object('kind','import.process','importId',p_import_id,'accountId',p_account_id), left(p_error,1000), v_attempts);
    return 'dead_lettered';
  end if;
  update public.imports set status = 'staged', processing_error = left(p_error, 1000), processing_updated_at = now(), updated_at = now() where id = p_import_id;
  return 'retrying';
end; $$;

create or replace function public.record_queue_rejection(p_queue_name text, p_payload jsonb, p_reason text, p_attempts integer default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.queue_rejections(queue_name, payload, reason, attempts) values (left(p_queue_name,100), p_payload, left(p_reason,1000), greatest(0,p_attempts)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.replay_queue_rejection(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.queue_rejections%rowtype;
begin
  select * into v_row from public.queue_rejections where id = p_id and status = 'dead_lettered' for update;
  if not found then return null; end if;
  update public.queue_rejections set status = 'replayed', replayed_at = now() where id = p_id;
  return v_row.payload;
end; $$;

revoke all on function public.claim_import_processing(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.advance_import_processing(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_import_processing(uuid,uuid) from public, anon, authenticated;
revoke all on function public.fail_import_processing(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.record_queue_rejection(text,jsonb,text,integer) from public, anon, authenticated;
revoke all on function public.replay_queue_rejection(uuid) from public, anon, authenticated;
