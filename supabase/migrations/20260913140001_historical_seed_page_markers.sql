-- Page-level idempotency for a crash between price writes and seed cursor update.
-- The marker is service-owned alongside the seed job and does not expose source
-- data to browser clients.
create table public.historical_seed_pages (
  id uuid primary key default gen_random_uuid(),
  seed_job_id uuid not null references public.historical_seed_jobs(id) on delete cascade,
  page_key text not null,
  source_revision text not null,
  created_at timestamptz not null default now(),
  unique (seed_job_id, page_key)
);

alter table public.historical_seed_pages enable row level security;
revoke all on public.historical_seed_pages from public, anon, authenticated;
