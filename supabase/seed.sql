-- Deterministic local fixtures used by the integration harness. These are
-- deliberately non-user-owned rows; authenticated test users and accounts are
-- created through the local Supabase Auth API by the harness.
insert into public.instruments (id, asset_type, display_name)
values
  ('11111111-1111-4111-8111-111111111111', 'stock', 'Apple Inc.'),
  ('22222222-2222-4222-8222-222222222222', 'etf', 'Vanguard Total Stock Market ETF')
on conflict (id) do update set asset_type = excluded.asset_type, display_name = excluded.display_name;

insert into public.instrument_aliases (instrument_id, symbol, effective_from, effective_to)
values
  ('11111111-1111-4111-8111-111111111111', 'AAPL', '1980-12-12', null),
  ('22222222-2222-4222-8222-222222222222', 'VTI', '2001-05-31', null)
on conflict (instrument_id, symbol, effective_from) do update set effective_to = excluded.effective_to;
