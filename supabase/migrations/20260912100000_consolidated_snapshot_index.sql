-- Consolidated reads always target null account_id and one report type. Keep
-- the latest snapshot lookup bounded as account snapshots accumulate.
create index if not exists report_snapshots_consolidated_latest_idx
  on public.report_snapshots (user_id, as_of_date desc, published_at desc, id desc)
  where account_id is null and report_type = 'consolidated_daily';
