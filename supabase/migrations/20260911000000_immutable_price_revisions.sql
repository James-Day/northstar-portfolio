-- Price rows and correction rows are immutable within their version key.
-- PostgREST upserts remain safe for retries, but cannot silently replace a
-- value under the same source/correction revision.
create or replace function public.reject_price_revision_overwrite()
returns trigger
language plpgsql
as $$
begin
  if old.instrument_id is distinct from new.instrument_id
    or old.trading_date is distinct from new.trading_date
    or old.price_revision_id is distinct from new.price_revision_id
    or old.close is distinct from new.close then
    raise exception 'daily price revision rows are immutable once written';
  end if;
  return old;
end;
$$;

drop trigger if exists daily_prices_immutable_revision on public.daily_prices;
create trigger daily_prices_immutable_revision
before update on public.daily_prices
for each row execute function public.reject_price_revision_overwrite();

create or replace function public.reject_price_correction_overwrite()
returns trigger
language plpgsql
as $$
begin
  if old.instrument_id is distinct from new.instrument_id
    or old.trading_date is distinct from new.trading_date
    or old.correction_version is distinct from new.correction_version
    or old.corrected_close is distinct from new.corrected_close
    or old.evidence is distinct from new.evidence then
    raise exception 'price correction versions are immutable once written';
  end if;
  return old;
end;
$$;

drop trigger if exists price_corrections_immutable_version on public.price_corrections;
create trigger price_corrections_immutable_version
before update on public.price_corrections
for each row execute function public.reject_price_correction_overwrite();

revoke all on function public.reject_price_revision_overwrite() from public;
revoke all on function public.reject_price_correction_overwrite() from public;
