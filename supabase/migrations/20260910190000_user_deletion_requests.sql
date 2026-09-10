-- Creates an auditable deletion request and immutable cleanup plan.
-- Irreversible auth/storage/database/billing effects belong to a separately
-- deployed worker, which advances the request through the lifecycle.
create table if not exists public.user_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  processing_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  updated_at timestamptz not null default now()
);

create unique index if not exists user_deletion_requests_active_idx
  on public.user_deletion_requests(user_id)
  where status in ('requested', 'processing');

create table if not exists public.user_deletion_plan_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.user_deletion_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('raw_object', 'account', 'report_snapshots', 'profile', 'billing_customer', 'auth_user')),
  target_id uuid,
  target_path text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((target_type = 'raw_object' and target_path is not null and target_id is null) or (target_type <> 'raw_object' and target_path is null))
);

create unique index if not exists user_deletion_plan_item_unique_target
  on public.user_deletion_plan_items(request_id, target_type, coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(target_path, ''));
create index if not exists user_deletion_plan_items_request_idx on public.user_deletion_plan_items(request_id, status);

alter table public.user_deletion_requests enable row level security;
alter table public.user_deletion_plan_items enable row level security;
drop policy if exists user_deletion_requests_owner on public.user_deletion_requests;
create policy user_deletion_requests_owner on public.user_deletion_requests for select using (user_id = auth.uid());
drop policy if exists user_deletion_plan_items_owner on public.user_deletion_plan_items;
create policy user_deletion_plan_items_owner on public.user_deletion_plan_items for select using (user_id = auth.uid());

create or replace function public.request_user_data_deletion()
returns setof public.user_deletion_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.user_deletion_requests%rowtype;
  v_account_ids uuid[];
  v_billing_exists boolean;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;

  select * into v_request from public.user_deletion_requests
  where user_id = v_user_id and status in ('requested', 'processing')
  order by requested_at desc limit 1 for update;

  if found then return next v_request; return; end if;

  insert into public.user_deletion_requests (user_id) values (v_user_id) returning * into v_request;
  select coalesce(array_agg(a.id), '{}'::uuid[]) into v_account_ids from public.accounts a where a.user_id = v_user_id;
  if coalesce(array_length(v_account_ids, 1), 0) > 0 then
    insert into public.user_deletion_plan_items (request_id, user_id, target_type, target_id)
    select v_request.id, v_user_id, 'account', unnest(v_account_ids);
  end if;
  insert into public.user_deletion_plan_items (request_id, user_id, target_type)
    values (v_request.id, v_user_id, 'report_snapshots'), (v_request.id, v_user_id, 'profile'), (v_request.id, v_user_id, 'auth_user');
  insert into public.user_deletion_plan_items (request_id, user_id, target_type, target_id)
    select v_request.id, v_user_id, 'billing_customer', bc.user_id from public.billing_customers bc where bc.user_id = v_user_id;
  insert into public.user_deletion_plan_items (request_id, user_id, target_type, target_path)
    select v_request.id, v_user_id, 'raw_object', i.storage_object_path from public.imports i join public.accounts a on a.id = i.account_id
    where a.user_id = v_user_id and i.storage_object_path is not null;
  insert into public.audit_events (user_id, event_type, entity_type, entity_id, metadata)
    values (v_user_id, 'deletion_requested', 'user_deletion_request', v_request.id, jsonb_build_object('plan_created', true));
  insert into public.job_outbox (event_type, payload)
    values ('user.delete', jsonb_build_object('requestId', v_request.id, 'userId', v_user_id));
  return next v_request;
end;
$$;

revoke all on function public.request_user_data_deletion() from public;
grant execute on function public.request_user_data_deletion() to authenticated;
