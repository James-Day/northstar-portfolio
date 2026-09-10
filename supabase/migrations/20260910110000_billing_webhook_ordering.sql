-- Persist Stripe delivery history separately from the current entitlement.
-- This migration is additive so existing development databases can upgrade
-- without rebuilding the initial schema.
alter table public.billing_customers
  add column if not exists last_webhook_created_at timestamptz,
  add column if not exists last_webhook_id text;

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_event_id text not null unique,
  event_type text not null,
  event_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied boolean not null default false,
  ignored_reason text check (ignored_reason in ('duplicate', 'out_of_order')),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists billing_webhook_events_user_created_idx
  on public.billing_webhook_events(user_id, event_created_at desc);

alter table public.billing_webhook_events enable row level security;

drop policy if exists billing_webhook_events_owner on public.billing_webhook_events;
create policy billing_webhook_events_owner
  on public.billing_webhook_events for select
  using (user_id = auth.uid());
