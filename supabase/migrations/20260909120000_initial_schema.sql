create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  brokerage text not null default 'robinhood' check (brokerage = 'robinhood'),
  account_type text not null check (account_type in ('individual', 'traditional_ira', 'roth_ira')),
  name text not null,
  currency char(3) not null default 'USD' check (currency = 'USD'),
  activity_covered_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  asset_type text not null check (asset_type in ('stock', 'etf')),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.instrument_aliases (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  symbol text not null check (symbol = upper(symbol)),
  effective_from date not null,
  effective_to date,
  check (effective_to is null or effective_to >= effective_from),
  unique (instrument_id, symbol, effective_from)
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  status text not null check (status in ('staged', 'processing', 'ready_for_review', 'committed', 'discarded', 'undone', 'failed')),
  file_name text not null,
  file_sha256 char(64) not null,
  storage_object_path text,
  parser_version text not null,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  usable_row_count integer not null default 0 check (usable_row_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  activity_from date,
  activity_through date,
  committed_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, file_sha256)
);

create table public.import_source_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  raw_row jsonb not null,
  normalized_payload jsonb,
  parse_status text not null check (parse_status in ('supported', 'unsupported', 'invalid', 'duplicate')),
  message text,
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  import_id uuid references public.imports(id) on delete restrict,
  source_row_id uuid references public.import_source_rows(id) on delete restrict,
  effective_date date not null,
  entry_type text not null check (entry_type in ('buy', 'sell', 'dividend', 'drip_buy', 'interest', 'fee', 'deposit', 'withdrawal', 'ira_incentive', 'transfer_in', 'transfer_out', 'opening_cash', 'opening_position')),
  instrument_id uuid references public.instruments(id) on delete restrict,
  quantity numeric(38,12),
  unit_price numeric(38,12),
  cash_amount numeric(38,12) not null,
  external_flow boolean not null default false,
  internal_transfer_group uuid,
  description text not null,
  fingerprint char(64),
  created_at timestamptz not null default now(),
  check ((entry_type in ('buy', 'sell', 'dividend', 'drip_buy', 'opening_position') and instrument_id is not null) or entry_type not in ('buy', 'sell', 'dividend', 'drip_buy', 'opening_position')),
  check (quantity is null or quantity >= 0)
);

create unique index ledger_entries_import_source_row_unique on public.ledger_entries(source_row_id) where source_row_id is not null;
create index ledger_entries_account_date_idx on public.ledger_entries(account_id, effective_date);
create index ledger_entries_fingerprint_idx on public.ledger_entries(account_id, fingerprint);

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  opening_entry_id uuid references public.ledger_entries(id) on delete restrict,
  acquired_on date,
  original_quantity numeric(38,12) not null check (original_quantity >= 0),
  remaining_quantity numeric(38,12) not null check (remaining_quantity >= 0 and remaining_quantity <= original_quantity),
  total_cost_basis numeric(38,12),
  basis_known boolean not null default true,
  created_at timestamptz not null default now(),
  check ((basis_known and total_cost_basis is not null) or not basis_known)
);

create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  action_date date not null,
  action_type text not null check (action_type in ('split', 'symbol_change')),
  ratio_numerator numeric(38,12),
  ratio_denominator numeric(38,12),
  source text not null,
  source_revision text not null,
  status text not null default 'quarantined' check (status in ('quarantined', 'validated', 'rejected')),
  evidence text,
  created_at timestamptz not null default now(),
  check ((action_type = 'split' and ratio_numerator > 0 and ratio_denominator > 0) or action_type = 'symbol_change')
);

create table public.price_revisions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('dolthub', 'marketstack', 'manual_correction')),
  source_revision text not null,
  ingested_at timestamptz not null default now(),
  notes text,
  unique (source, source_revision)
);

create table public.daily_prices (
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  trading_date date not null,
  close numeric(38,12) not null check (close > 0),
  price_revision_id uuid not null references public.price_revisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (instrument_id, trading_date, price_revision_id)
);

create index daily_prices_lookup_idx on public.daily_prices(instrument_id, trading_date desc);

create table public.price_corrections (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  trading_date date not null,
  corrected_close numeric(38,12) not null check (corrected_close > 0),
  evidence text not null,
  correction_version text not null,
  created_at timestamptz not null default now(),
  unique (instrument_id, trading_date, correction_version)
);

create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  report_type text not null check (report_type in ('account_daily', 'consolidated_daily', 'dashboard')),
  as_of_date date not null,
  import_state_revision text not null,
  price_revision_id uuid references public.price_revisions(id) on delete restrict,
  payload jsonb not null,
  published_at timestamptz not null default now()
);

create index report_snapshots_user_date_idx on public.report_snapshots(user_id, as_of_date desc);

create table public.billing_customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text unique,
  entitlement_status text not null default 'inactive' check (entitlement_status in ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.job_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.imports enable row level security;
alter table public.import_source_rows enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.lots enable row level security;
alter table public.report_snapshots enable row level security;
alter table public.billing_customers enable row level security;
alter table public.audit_events enable row level security;
alter table public.instruments enable row level security;
alter table public.instrument_aliases enable row level security;
alter table public.corporate_actions enable row level security;
alter table public.price_revisions enable row level security;
alter table public.daily_prices enable row level security;
alter table public.price_corrections enable row level security;

create policy profiles_owner on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy accounts_owner on public.accounts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy imports_owner on public.imports for all using (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())) with check (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy import_source_rows_owner on public.import_source_rows for all using (exists (select 1 from public.imports i join public.accounts a on a.id = i.account_id where i.id = import_id and a.user_id = auth.uid())) with check (exists (select 1 from public.imports i join public.accounts a on a.id = i.account_id where i.id = import_id and a.user_id = auth.uid()));
create policy ledger_entries_owner on public.ledger_entries for all using (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())) with check (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy lots_owner on public.lots for all using (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())) with check (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy report_snapshots_owner on public.report_snapshots for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy billing_customer_owner on public.billing_customers for select using (user_id = auth.uid());
create policy audit_events_owner on public.audit_events for select using (user_id = auth.uid());
create policy instruments_read on public.instruments for select using (true);
create policy instrument_aliases_read on public.instrument_aliases for select using (true);
create policy corporate_actions_read on public.corporate_actions for select using (status = 'validated');
create policy price_revisions_read on public.price_revisions for select using (true);
create policy daily_prices_read on public.daily_prices for select using (true);
create policy price_corrections_read on public.price_corrections for select using (true);

insert into storage.buckets (id, name, public) values ('brokerage-statements', 'brokerage-statements', false) on conflict (id) do nothing;
create policy brokerage_statement_select on storage.objects for select using (bucket_id = 'brokerage-statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy brokerage_statement_insert on storage.objects for insert with check (bucket_id = 'brokerage-statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy brokerage_statement_delete on storage.objects for delete using (bucket_id = 'brokerage-statements' and (storage.foldername(name))[1] = auth.uid()::text);
