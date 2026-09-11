alter table public.market_data_job_runs add column if not exists unresolved_instrument_count integer not null default 0 check (unresolved_instrument_count >= 0);
