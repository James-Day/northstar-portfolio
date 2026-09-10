-- A new immutable daily-price revision can affect every account that has
-- imported activity for that instrument. Enqueue report work from the same
-- database write so a successful price insert cannot be separated from its
-- report trigger by a worker crash.
alter table public.job_outbox
  add column if not exists dedupe_key text;

create unique index if not exists job_outbox_dedupe_key_unique
  on public.job_outbox(dedupe_key)
  where dedupe_key is not null;

create or replace function public.enqueue_price_report_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.job_outbox (event_type, payload, dedupe_key)
  select
    'price.updated',
    jsonb_build_object(
      'accountId', e.account_id,
      'instrumentId', NEW.instrument_id,
      'tradingDate', NEW.trading_date,
      'priceRevisionId', NEW.price_revision_id
    ),
    'price.updated:' || e.account_id::text || ':' || NEW.instrument_id::text || ':' || NEW.trading_date::text || ':' || NEW.price_revision_id::text
  from public.ledger_entries e
  join public.imports i on i.id = e.import_id and i.status = 'committed'
  where e.instrument_id = NEW.instrument_id
  group by e.account_id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return NEW;
end;
$$;

drop trigger if exists daily_prices_enqueue_report_outbox on public.daily_prices;
create trigger daily_prices_enqueue_report_outbox
after insert on public.daily_prices
for each row execute function public.enqueue_price_report_outbox();

revoke all on function public.enqueue_price_report_outbox() from public;
