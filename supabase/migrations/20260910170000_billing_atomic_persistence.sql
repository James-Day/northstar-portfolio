-- Billing state is mutated by security-definer RPCs so trial creation and
-- webhook delivery history remain atomic and cannot be forged by the browser.
create or replace function public.start_trial_for_user(p_user_id uuid)
returns setof public.billing_customers
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.billing_customers (user_id, entitlement_status, trial_started_at, trial_ends_at)
  values (p_user_id, 'trialing', now(), now() + interval '14 days')
  on conflict (user_id) do update
    set entitlement_status = 'trialing', trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at, updated_at = now()
    where public.billing_customers.trial_started_at is null
      and public.billing_customers.entitlement_status = 'inactive';
  return query select * from public.billing_customers where user_id = p_user_id;
end;
$$;

create or replace function public.start_trial_after_committed_import()
returns setof public.billing_customers
language plpgsql security invoker set search_path = public
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  return query
    select * from public.start_trial_for_user(v_user_id)
    where exists (
      select 1 from public.imports i join public.accounts a on a.id = i.account_id
      where a.user_id = v_user_id and i.status = 'committed'
    );
end;
$$;

revoke all on function public.start_trial_for_user(uuid) from public;
revoke all on function public.start_trial_after_committed_import() from public;
grant execute on function public.start_trial_after_committed_import() to authenticated;

create or replace function public.start_trial_on_import_commit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid;
begin
  if new.status = 'committed' and old.status is distinct from new.status then
    select a.user_id into v_user_id from public.accounts a where a.id = new.account_id;
    if v_user_id is not null then perform public.start_trial_for_user(v_user_id); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists imports_start_trial_on_commit on public.imports;
create trigger imports_start_trial_on_commit
  after update of status on public.imports
  for each row execute function public.start_trial_on_import_commit();

revoke all on function public.start_trial_on_import_commit() from public;

create or replace function public.apply_billing_webhook(
  p_user_id uuid, p_event_id text, p_event_type text, p_event_created_at timestamptz, p_payload jsonb default '{}'::jsonb
)
returns setof public.billing_customers
language plpgsql security definer set search_path = public
as $$
declare v_customer public.billing_customers%rowtype; v_status text;
begin
  if p_event_id is null or p_event_id = '' then raise exception 'Webhook event id is required.' using errcode = '22023'; end if;
  select * into v_customer from public.billing_customers where user_id = p_user_id for update;
  if not found then raise exception 'Billing customer not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.billing_webhook_events where stripe_event_id = p_event_id) then
    return next v_customer; return;
  end if;
  if v_customer.last_webhook_created_at is not null and (p_event_created_at < v_customer.last_webhook_created_at or (p_event_created_at = v_customer.last_webhook_created_at and p_event_id <= coalesce(v_customer.last_webhook_id, ''))) then
    insert into public.billing_webhook_events (user_id, stripe_event_id, event_type, event_created_at, applied, ignored_reason, payload) values (p_user_id, p_event_id, p_event_type, p_event_created_at, false, case when p_event_created_at < v_customer.last_webhook_created_at then 'out_of_order' else 'out_of_order' end, p_payload);
    return next v_customer; return;
  end if;
  v_status := case p_event_type when 'subscription_active' then 'active' when 'subscription_past_due' then 'past_due' when 'subscription_canceled' then 'canceled' else null end;
  if v_status is null then raise exception 'Unsupported billing webhook event.' using errcode = '22023'; end if;
  update public.billing_customers set entitlement_status = v_status, last_webhook_created_at = p_event_created_at, last_webhook_id = p_event_id, updated_at = now() where user_id = p_user_id returning * into v_customer;
  insert into public.billing_webhook_events (user_id, stripe_event_id, event_type, event_created_at, applied, payload) values (p_user_id, p_event_id, p_event_type, p_event_created_at, true, p_payload);
  return next v_customer;
end;
$$;

revoke all on function public.apply_billing_webhook(uuid, text, text, timestamptz, jsonb) from public;
