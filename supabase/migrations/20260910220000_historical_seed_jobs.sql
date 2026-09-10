-- Durable resumable DoltHub historical seed state and review queue.
create table public.historical_seed_jobs (
  id uuid primary key default gen_random_uuid(),
  seed_key text not null unique,
  source text not null check (source = 'dolthub'),
  symbols text[] not null,
  from_date date not null,
  through_date date not null,
  page_limit integer not null check (page_limit between 1 and 5000),
  source_revision text,
  cursor_date date,
  cursor_symbol text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  pages integer not null default 0 check (pages >= 0),
  accepted_rows integer not null default 0 check (accepted_rows >= 0),
  quarantined_rows integer not null default 0 check (quarantined_rows >= 0),
  continuity_issues jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (from_date <= through_date),
  check ((cursor_date is null and cursor_symbol is null) or (cursor_date is not null and cursor_symbol is not null))
);

create table public.historical_seed_mappings (
  id uuid primary key default gen_random_uuid(),
  seed_job_id uuid not null references public.historical_seed_jobs(id) on delete cascade,
  source_revision text not null,
  source_symbol text not null,
  trading_date date not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (seed_job_id, source_revision, source_symbol, trading_date)
);

create table public.historical_seed_quarantine (
  id uuid primary key default gen_random_uuid(),
  seed_job_id uuid not null references public.historical_seed_jobs(id) on delete cascade,
  source_revision text not null,
  source_symbol text not null,
  trading_date date not null,
  close numeric(38,12),
  reason text not null,
  raw_record jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'validated', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (seed_job_id, source_revision, source_symbol, trading_date, reason)
);

create index historical_seed_quarantine_review_idx on public.historical_seed_quarantine(status, created_at);
create index historical_seed_mappings_instrument_idx on public.historical_seed_mappings(instrument_id, trading_date);

alter table public.historical_seed_jobs enable row level security;
alter table public.historical_seed_mappings enable row level security;
alter table public.historical_seed_quarantine enable row level security;
-- These shared ingestion/operator tables are written by the server service role.
-- No client policies are granted; service-role writes bypass RLS.
