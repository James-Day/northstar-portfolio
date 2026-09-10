-- Publication keys must be scoped by user as well as account. Consolidated
-- and dashboard snapshots have a null account_id, so omitting user_id would
-- make one user's publication collide with another user's snapshot.
drop index if exists public.report_snapshots_publication_key_unique;
alter table public.report_snapshots drop column if exists publication_key;
alter table public.report_snapshots
  add column publication_key text generated always as (
    user_id::text || ':' || coalesce(account_id::text, 'consolidated') || ':' || report_type || ':' ||
    as_of_date::text || ':' || import_state_revision || ':' || coalesce(price_revision_id::text, 'none')
  ) stored;

create unique index report_snapshots_publication_key_unique
  on public.report_snapshots(publication_key);

alter table public.report_snapshots
  add constraint report_snapshots_account_scope_check
  check (report_type <> 'account_daily' or account_id is not null);
