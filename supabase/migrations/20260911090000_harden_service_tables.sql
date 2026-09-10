-- Service-owned queues and historical seed state must never be writable through
-- the anon/authenticated database roles. The service role bypasses RLS and is
-- the only caller of the worker RPCs that operate on these tables.
alter table public.job_outbox enable row level security;
alter table public.queue_rejections enable row level security;
revoke all on public.job_outbox from public, anon, authenticated;
revoke all on public.queue_rejections from public, anon, authenticated;

revoke all on public.historical_seed_jobs,
  public.historical_seed_mappings,
  public.historical_seed_quarantine
  from public, anon, authenticated;

-- Make the intended role boundary explicit even if an earlier migration only
-- revoked anon/authenticated (or used a grouped grant).
revoke all on public.market_data_job_runs from public, anon, authenticated;
revoke all on public.market_data_quota_buckets from public, anon, authenticated;
revoke all on public.market_data_quota_reservations from public, anon, authenticated;
