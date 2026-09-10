-- Worker-only claim/complete/fail boundary for persisted user deletion plans.
alter table public.user_deletion_plan_items add column if not exists available_at timestamptz not null default now();
alter table public.user_deletion_plan_items add column if not exists claimed_at timestamptz;
create index if not exists user_deletion_plan_claim_idx on public.user_deletion_plan_items(status, available_at, created_at);

create or replace function public.claim_user_deletion_plan_items(p_limit integer default 25, p_now timestamptz default now(), p_max_attempts integer default 8)
returns table(id uuid, request_id uuid, user_id uuid, target_type text, target_id uuid, target_path text, attempts integer)
language plpgsql security definer set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'Deletion claim limit is out of range.'; end if;
  update public.user_deletion_requests r set status = 'processing', processing_at = coalesce(r.processing_at, p_now), updated_at = p_now
  where r.id in (
    select distinct i.request_id from public.user_deletion_plan_items i
    join public.user_deletion_requests r2 on r2.id = i.request_id
    where (r2.status in ('requested', 'processing') or r2.status = 'failed')
      and (i.status in ('pending', 'failed') and i.available_at <= p_now or i.status = 'processing' and i.claimed_at < p_now - interval '15 minutes')
    limit p_limit
  );
  return query
  with candidates as (
    select i.id from public.user_deletion_plan_items i
    join public.user_deletion_requests r on r.id = i.request_id
    where r.status = 'processing'
      and ((i.status in ('pending', 'failed') and i.available_at <= p_now) or (i.status = 'processing' and i.claimed_at < p_now - interval '15 minutes'))
      and i.attempts < p_max_attempts
    order by case i.target_type when 'raw_object' then 10 when 'account' then 20 when 'report_snapshots' then 30 when 'billing_customer' then 40 when 'profile' then 50 else 60 end, i.created_at
    for update of i skip locked limit p_limit
  )
  update public.user_deletion_plan_items i
  set status = 'processing', attempts = i.attempts + 1, claimed_at = p_now, available_at = p_now, last_error = null
  from candidates c where i.id = c.id
  returning i.id, i.request_id, i.user_id, i.target_type, i.target_id, i.target_path, i.attempts;
end;
$$;

create or replace function public.complete_user_deletion_plan_item(p_id uuid, p_completed_at timestamptz default now())
returns void language plpgsql security definer set search_path = public
as $$
declare v_request_id uuid; v_user_id uuid;
begin
  update public.user_deletion_plan_items set status = 'completed', completed_at = coalesce(completed_at, p_completed_at), claimed_at = null, last_error = null where id = p_id and status = 'processing' returning request_id, user_id into v_request_id, v_user_id;
  if v_request_id is null then return; end if;
  if not exists (select 1 from public.user_deletion_plan_items where request_id = v_request_id and status <> 'completed') then
    update public.user_deletion_requests set status = 'completed', completed_at = p_completed_at, updated_at = p_completed_at where id = v_request_id and status = 'processing';
  end if;
end;
$$;

create or replace function public.fail_user_deletion_plan_item(p_id uuid, p_failed_at timestamptz, p_available_at timestamptz, p_error text, p_max_attempts integer default 8)
returns table(outcome text) language plpgsql security definer set search_path = public
as $$
declare v_item public.user_deletion_plan_items%rowtype; v_outcome text;
begin
  select * into v_item from public.user_deletion_plan_items where id = p_id and status = 'processing' for update;
  if not found then return query select 'ignored'::text; return; end if;
  if v_item.attempts >= p_max_attempts then
    update public.user_deletion_plan_items set status = 'failed', claimed_at = null, last_error = left(p_error, 1000) where id = p_id;
    update public.user_deletion_requests set status = 'failed', failed_at = p_failed_at, failure_reason = left(p_error, 1000), updated_at = p_failed_at where id = v_item.request_id and status = 'processing';
    v_outcome := 'exhausted';
  else
    update public.user_deletion_plan_items set status = 'pending', available_at = p_available_at, claimed_at = null, last_error = left(p_error, 1000) where id = p_id;
    v_outcome := 'retrying';
  end if;
  return query select v_outcome;
end;
$$;

revoke all on function public.claim_user_deletion_plan_items(integer, timestamptz, integer) from public;
revoke all on function public.complete_user_deletion_plan_item(uuid, timestamptz) from public;
revoke all on function public.fail_user_deletion_plan_item(uuid, timestamptz, timestamptz, text, integer) from public;
grant execute on function public.claim_user_deletion_plan_items(integer, timestamptz, integer) to service_role;
grant execute on function public.complete_user_deletion_plan_item(uuid, timestamptz) to service_role;
grant execute on function public.fail_user_deletion_plan_item(uuid, timestamptz, timestamptz, text, integer) to service_role;
