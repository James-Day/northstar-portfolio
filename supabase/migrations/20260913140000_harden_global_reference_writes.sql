-- Shared market/reference data is readable through its RLS SELECT policies,
-- but must never be writable by a browser role. Daily refresh, seed, and
-- correction workflows use the service role or trusted database functions.
revoke insert, update, delete on public.instruments,
  public.instrument_aliases,
  public.corporate_actions,
  public.price_revisions,
  public.daily_prices,
  public.price_corrections
  from public, anon, authenticated;

grant select on public.instruments,
  public.instrument_aliases,
  public.corporate_actions,
  public.price_revisions,
  public.daily_prices,
  public.price_corrections
  to anon, authenticated;
