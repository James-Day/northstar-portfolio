-- Normalize all database-originated report events through one dedupe rule.
-- Commit/undo RPCs already use the transactional outbox, so this trigger makes
-- retries and repeated function definitions converge on one event per source
-- mutation without changing the immutable ledger records.
create or replace function public.set_report_outbox_dedupe_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import_id text := new.payload ->> 'importId';
  v_account_id text := new.payload ->> 'accountId';
  v_instrument_id text := new.payload ->> 'instrumentId';
  v_trading_date text := new.payload ->> 'tradingDate';
  v_revision text := coalesce(new.payload ->> 'priceRevisionId', new.payload ->> 'correctionVersion');
begin
  if new.dedupe_key is null then
    if new.event_type in ('import.committed', 'import.undone')
       and nullif(v_import_id, '') is not null then
      new.dedupe_key := new.event_type || ':' || v_import_id;
    elsif new.event_type = 'price.updated'
      and nullif(v_account_id, '') is not null
      and nullif(v_instrument_id, '') is not null
      and nullif(v_trading_date, '') is not null
      and nullif(v_revision, '') is not null then
      new.dedupe_key := 'price.updated:' || v_account_id || ':' || v_instrument_id || ':' || v_trading_date || ':' || v_revision;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists job_outbox_report_dedupe on public.job_outbox;
create trigger job_outbox_report_dedupe
before insert on public.job_outbox
for each row execute function public.set_report_outbox_dedupe_key();

-- A confirmed correction changes the authoritative close without necessarily
-- inserting a new daily_prices row. Give affected accounts the same durable
-- report path as provider price updates.
create or replace function public.enqueue_price_correction_report_outbox()
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
      'instrumentId', new.instrument_id,
      'tradingDate', new.trading_date,
      'correctionVersion', new.correction_version
    ),
    'price.updated:' || e.account_id::text || ':' || new.instrument_id::text || ':' || new.trading_date::text || ':' || new.correction_version
  from public.ledger_entries e
  join public.imports i on i.id = e.import_id and i.status = 'committed'
  where e.instrument_id = new.instrument_id
  group by e.account_id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

drop trigger if exists price_corrections_enqueue_report_outbox on public.price_corrections;
create trigger price_corrections_enqueue_report_outbox
after insert on public.price_corrections
for each row execute function public.enqueue_price_correction_report_outbox();

revoke all on function public.set_report_outbox_dedupe_key() from public;
revoke all on function public.enqueue_price_correction_report_outbox() from public;
