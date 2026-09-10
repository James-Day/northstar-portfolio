alter table public.market_data_job_runs
  add column if not exists publication_pending_symbols integer not null default 0
  check (publication_pending_symbols >= 0);

comment on column public.market_data_job_runs.publication_pending_symbols is
  'Symbols whose requested daily close was not published yet; no price is fabricated.';
