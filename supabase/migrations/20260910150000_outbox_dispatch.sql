-- Claiming happens in one transaction so two queue pollers cannot publish the
-- same pending row at the same time. Service-role workers call these RPCs.
create index if not exists job_outbox_claim_idx
  on public.job_outbox(status, available_at, created_at);
alter table public.job_outbox add column if not exists last_error text;

create or replace function public.claim_job_outbox(p_limit integer default 25, p_now timestamptz default now())
returns table(id uuid, event_type text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimed as (
    select o.id
    from public.job_outbox o
    where o.status = 'pending' and o.available_at <= p_now
    order by o.created_at, o.id
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update public.job_outbox o
  set status = 'processing', attempts = o.attempts + 1
  from claimed c
  where o.id = c.id
  returning o.id, o.event_type, o.payload, o.attempts;
end;
$$;

create or replace function public.complete_job_outbox(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.job_outbox set status = 'completed', completed_at = now()
  where id = p_id and status = 'processing';
end;
$$;

create or replace function public.fail_job_outbox(p_id uuid, p_available_at timestamptz, p_error text, p_max_attempts integer default 8)
returns text language plpgsql security definer set search_path = public
as $$
declare v_attempts integer;
begin
  select attempts into v_attempts from public.job_outbox where id = p_id and status = 'processing' for update;
  if not found then return 'missing'; end if;
  if v_attempts >= greatest(1, p_max_attempts) then
    update public.job_outbox set status = 'failed', completed_at = now(), last_error = left(p_error, 1000) where id = p_id;
    return 'failed';
  end if;
  update public.job_outbox set status = 'pending', available_at = p_available_at, last_error = left(p_error, 1000) where id = p_id;
  return 'retrying';
end;
$$;
