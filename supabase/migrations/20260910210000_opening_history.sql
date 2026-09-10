create table public.account_opening_history (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  opening_cash numeric(38,12) not null default 0 check (opening_cash >= 0),
  activity_covered_from date,
  incomplete_reason text,
  positions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(positions) = 'array')
);
alter table public.account_opening_history enable row level security;
create policy account_opening_history_owner on public.account_opening_history for all using (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())) with check (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid()));
