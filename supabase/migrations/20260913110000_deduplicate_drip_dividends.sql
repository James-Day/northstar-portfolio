-- Keep the persisted commit path consistent with the importer: a Robinhood
-- export that contains both an explicit cash dividend and a DRIP row must
-- produce one dividend-income event, while retaining the separate DRIP buy.

create or replace function public.skip_duplicate_drip_dividend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entry_type = 'dividend'
     and new.description like '%(reinvested dividend income)'
     and exists (
       select 1
       from public.ledger_entries existing
       where existing.account_id = new.account_id
         and existing.import_id = new.import_id
         and existing.entry_type = 'dividend'
         and existing.description not like '%(reinvested dividend income)'
         and existing.instrument_id is not distinct from new.instrument_id
         and existing.effective_date = new.effective_date
         and existing.cash_amount = new.cash_amount
     ) then
    return null;
  end if;
  return new;
end;
$$;

create or replace function public.remove_duplicate_drip_dividend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entry_type = 'dividend'
     and new.description not like '%(reinvested dividend income)' then
    delete from public.ledger_entries derived
    where derived.account_id = new.account_id
      and derived.import_id = new.import_id
      and derived.entry_type = 'dividend'
      and derived.description like '%(reinvested dividend income)'
      and derived.instrument_id is not distinct from new.instrument_id
      and derived.effective_date = new.effective_date
      and derived.cash_amount = new.cash_amount;
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_entries_skip_duplicate_drip_dividend on public.ledger_entries;
create trigger ledger_entries_skip_duplicate_drip_dividend
before insert or update on public.ledger_entries
for each row execute function public.skip_duplicate_drip_dividend();

drop trigger if exists ledger_entries_remove_duplicate_drip_dividend on public.ledger_entries;
create trigger ledger_entries_remove_duplicate_drip_dividend
after insert or update on public.ledger_entries
for each row execute function public.remove_duplicate_drip_dividend();

revoke all on function public.skip_duplicate_drip_dividend() from public;
revoke all on function public.remove_duplicate_drip_dividend() from public;
