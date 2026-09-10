-- A report worker may retry after a timeout. The same dependency versions must
-- resolve to one immutable snapshot rather than creating duplicates.
alter table public.report_snapshots
  add column publication_key text generated always as (
    coalesce(account_id::text, 'consolidated') || ':' || report_type || ':' ||
    as_of_date::text || ':' || import_state_revision || ':' ||
    coalesce(price_revision_id::text, 'none')
  ) stored;

create unique index report_snapshots_publication_key_unique
  on public.report_snapshots(publication_key);
