-- Durable worker state for private brokerage statement object retention.
-- Normalized imports/source rows remain intact when the original object is removed.
create table if not exists public.raw_file_retention (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null unique references public.imports(id) on delete cascade,
  object_path text not null,
  uploaded_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'deleting', 'deleted', 'exhausted')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  deleted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'deleted' and deleted_at is not null) or status <> 'deleted')
);
create index if not exists raw_file_retention_claim_idx on public.raw_file_retention(status, available_at, uploaded_at);

create table if not exists public.raw_file_retention_audit (
  id uuid primary key default gen_random_uuid(),
  retention_id uuid not null references public.raw_file_retention(id) on delete cascade,
  import_id uuid not null references public.imports(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  event_type text not null check (event_type in ('claimed', 'deleted', 'failed', 'exhausted')),
  error_message text,
  occurred_at timestamptz not null default now()
);
create index if not exists raw_file_retention_audit_lookup_idx on public.raw_file_retention_audit(retention_id, occurred_at);

alter table public.raw_file_retention enable row level security;
alter table public.raw_file_retention_audit enable row level security;
create policy raw_file_retention_owner on public.raw_file_retention for select using (exists (select 1 from public.imports i join public.accounts a on a.id = i.account_id where i.id = import_id and a.user_id = auth.uid()));
create policy raw_file_retention_audit_owner on public.raw_file_retention_audit for select using (exists (select 1 from public.imports i join public.accounts a on a.id = i.account_id where i.id = import_id and a.user_id = auth.uid()));

-- Link an object as soon as the import row receives its private Storage path.
create or replace function public.sync_raw_file_retention()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.storage_object_path is not null and (tg_op = 'INSERT' or old.storage_object_path is distinct from new.storage_object_path) then
    insert into public.raw_file_retention (import_id, object_path, uploaded_at)
    values (new.id, new.storage_object_path, new.created_at)
    on conflict (import_id) do update set object_path = excluded.object_path, updated_at = now()
      where raw_file_retention.status <> 'deleted';
  end if;
  return new;
end;
$$;
drop trigger if exists imports_sync_raw_file_retention on public.imports;
create trigger imports_sync_raw_file_retention after insert or update of storage_object_path on public.imports
for each row execute function public.sync_raw_file_retention();

-- A deleting claim older than 15 minutes is recoverable after a worker crash.
create or replace function public.claim_raw_file_retention(p_limit integer default 100, p_now timestamptz default now(), p_max_attempts integer default 8)
returns table(id uuid, import_id uuid, object_path text, uploaded_at timestamptz, deleted_at timestamptz, attempts integer)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select r.id
    from public.raw_file_retention r
    where r.attempts < greatest(1, p_max_attempts)
      and ((r.status = 'pending' and r.available_at <= p_now)
        or (r.status = 'deleting' and r.claimed_at < p_now - interval '15 minutes'))
    order by r.uploaded_at, r.id
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update public.raw_file_retention r
  set status = 'deleting', attempts = r.attempts + 1, claimed_at = p_now, updated_at = p_now
  from candidates c
  where r.id = c.id
  returning r.id, r.import_id, r.object_path, r.uploaded_at, r.deleted_at, r.attempts;

end;
$$;

create or replace function public.audit_raw_file_retention_claim()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'deleting' and old.status is distinct from new.status then
    insert into public.raw_file_retention_audit (retention_id, import_id, attempt, event_type, occurred_at)
    values (new.id, new.import_id, new.attempts, 'claimed', new.claimed_at);
  end if;
  return new;
end;
$$;
drop trigger if exists raw_file_retention_claim_audit on public.raw_file_retention;
create trigger raw_file_retention_claim_audit after update on public.raw_file_retention
for each row execute function public.audit_raw_file_retention_claim();

create or replace function public.complete_raw_file_retention(p_id uuid, p_deleted_at timestamptz default now())
returns void language plpgsql security definer set search_path = public
as $$
declare v_row public.raw_file_retention%rowtype;
begin
  select * into v_row from public.raw_file_retention where id = p_id and status = 'deleting' for update;
  if not found then return; end if;
  update public.raw_file_retention set status = 'deleted', deleted_at = p_deleted_at, claimed_at = null, last_error = null, updated_at = p_deleted_at where id = p_id;
  insert into public.raw_file_retention_audit (retention_id, import_id, attempt, event_type, occurred_at) values (p_id, v_row.import_id, v_row.attempts, 'deleted', p_deleted_at);
end;
$$;

create or replace function public.fail_raw_file_retention(p_id uuid, p_failed_at timestamptz, p_available_at timestamptz, p_error text, p_max_attempts integer default 8)
returns text language plpgsql security definer set search_path = public
as $$
declare v_row public.raw_file_retention%rowtype; v_status text;
begin
  select * into v_row from public.raw_file_retention where id = p_id and status = 'deleting' for update;
  if not found then return 'exhausted'; end if;
  if v_row.attempts >= greatest(1, p_max_attempts) then
    v_status := 'exhausted';
    update public.raw_file_retention set status = 'exhausted', claimed_at = null, last_error = left(p_error, 1000), updated_at = p_failed_at where id = p_id;
  else
    v_status := 'retrying';
    update public.raw_file_retention set status = 'pending', available_at = p_available_at, claimed_at = null, last_error = left(p_error, 1000), updated_at = p_failed_at where id = p_id;
  end if;
  insert into public.raw_file_retention_audit (retention_id, import_id, attempt, event_type, error_message, occurred_at) values (p_id, v_row.import_id, v_row.attempts, case when v_status = 'exhausted' then 'exhausted' else 'failed' end, left(p_error, 1000), p_failed_at);
  return v_status;
end;
$$;

revoke all on function public.claim_raw_file_retention(integer, timestamptz, integer) from public;
revoke all on function public.complete_raw_file_retention(uuid, timestamptz) from public;
revoke all on function public.fail_raw_file_retention(uuid, timestamptz, timestamptz, text, integer) from public;
grant execute on function public.claim_raw_file_retention(integer, timestamptz, integer) to service_role;
grant execute on function public.complete_raw_file_retention(uuid, timestamptz) to service_role;
grant execute on function public.fail_raw_file_retention(uuid, timestamptz, timestamptz, text, integer) to service_role;
