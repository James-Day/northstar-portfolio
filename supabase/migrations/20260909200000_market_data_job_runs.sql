create table public.market_data_job_runs (
  id uuid primary key default gen_random_uuid(),
  trading_date date,
  status text not null check (status in ('persisted', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  requested_symbols integer not null default 0 check (requested_symbols >= 0),
  persisted_rows integer not null default 0 check (persisted_rows >= 0),
  quota_units integer not null default 0 check (quota_units >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

alter table public.market_data_job_runs enable row level security;
revoke all on public.market_data_job_runs from anon, authenticated;
