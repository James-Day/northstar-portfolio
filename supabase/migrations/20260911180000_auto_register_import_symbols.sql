-- Robinhood CSV imports may contain legitimate symbols absent from the local
-- reference seed. Create a stable instrument identity at staging time so a
-- valid activity file is not blocked at commit solely by reference coverage.
create or replace function public.ensure_import_instrument_alias()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_activity jsonb := new.normalized_payload;
  v_symbol text := upper(btrim(coalesce(v_activity ->> 'symbol', '')));
  v_effective_date date := nullif(v_activity ->> 'effectiveDate', '')::date;
  v_instrument_id uuid;
begin
  if new.parse_status <> 'supported'
     or v_activity is null
     or v_activity ->> 'type' not in ('buy', 'sell', 'dividend', 'drip_buy', 'split')
     or v_symbol = ''
     or v_effective_date is null
     or v_symbol !~ '^[A-Z][A-Z0-9.-]{0,9}$' then
    return new;
  end if;

  select ia.instrument_id into v_instrument_id
  from public.instrument_aliases ia
  where ia.symbol = v_symbol
    and ia.effective_from <= v_effective_date
    and (ia.effective_to is null or ia.effective_to >= v_effective_date)
  order by ia.effective_from desc
  limit 1;

  if v_instrument_id is null then
    insert into public.instruments (asset_type, display_name)
    values ('stock', v_symbol)
    returning id into v_instrument_id;
    insert into public.instrument_aliases (instrument_id, symbol, effective_from)
    values (v_instrument_id, v_symbol, v_effective_date)
    on conflict (instrument_id, symbol, effective_from) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_import_instrument_alias() from public, anon, authenticated;
drop trigger if exists ensure_import_instrument_alias on public.import_source_rows;
create trigger ensure_import_instrument_alias
after insert on public.import_source_rows
for each row execute function public.ensure_import_instrument_alias();