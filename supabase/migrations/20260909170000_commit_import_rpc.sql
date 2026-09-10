create or replace function public.commit_import(p_import_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.imports%rowtype;
  v_row public.import_source_rows%rowtype;
  v_activity jsonb;
  v_type text;
  v_instrument_id uuid;
  v_entry_id uuid;
  v_supported_count integer := 0;
  v_invalid_count integer := 0;
  v_unsupported_count integer := 0;
begin
  select i.* into v_import
  from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid()
  for update of i;

  if not found then
    raise exception 'Import not found.' using errcode = '42501';
  end if;
  if v_import.status <> 'ready_for_review' then
    raise exception 'Only review-ready imports can be committed.' using errcode = '22023';
  end if;

  select count(*) filter (where parse_status = 'supported'),
         count(*) filter (where parse_status = 'invalid'),
         count(*) filter (where parse_status = 'unsupported')
  into v_supported_count, v_invalid_count, v_unsupported_count
  from public.import_source_rows
  where import_id = p_import_id;

  if v_supported_count = 0 or v_invalid_count > 0 or v_unsupported_count > 0 then
    raise exception 'Resolve invalid or unsupported rows before committing.' using errcode = '22023';
  end if;

  for v_row in select * from public.import_source_rows where import_id = p_import_id and parse_status = 'supported' order by row_number
  loop
    v_activity := v_row.normalized_payload;
    v_type := v_activity ->> 'type';
    if v_activity is null or v_type not in ('buy', 'sell', 'dividend', 'drip_buy', 'interest', 'fee', 'deposit', 'withdrawal', 'ira_incentive', 'transfer_in', 'transfer_out') then
      raise exception 'A supported source row has invalid normalized activity.' using errcode = '22023';
    end if;

    v_instrument_id := null;
    if v_type in ('buy', 'sell', 'dividend', 'drip_buy') then
      select ia.instrument_id into v_instrument_id
      from public.instrument_aliases ia
      where ia.symbol = upper(v_activity ->> 'symbol')
        and ia.effective_from <= (v_activity ->> 'effectiveDate')::date
        and (ia.effective_to is null or ia.effective_to >= (v_activity ->> 'effectiveDate')::date);
      if v_instrument_id is null then
        raise exception 'No stable instrument alias exists for source row %.', v_row.row_number using errcode = '22023';
      end if;
    end if;

    if v_type = 'drip_buy' then
      insert into public.ledger_entries (account_id, import_id, source_row_id, effective_date, entry_type, instrument_id, cash_amount, external_flow, description)
      values (v_import.account_id, p_import_id, v_row.id, (v_activity ->> 'effectiveDate')::date, 'dividend', v_instrument_id, abs((v_activity ->> 'amount')::numeric), false, (v_activity ->> 'description') || ' (reinvested dividend income)');
    end if;

    insert into public.ledger_entries (account_id, import_id, source_row_id, effective_date, entry_type, instrument_id, quantity, unit_price, cash_amount, external_flow, description)
    values (
      v_import.account_id, p_import_id, v_row.id, (v_activity ->> 'effectiveDate')::date, v_type, v_instrument_id,
      nullif(v_activity ->> 'quantity', '')::numeric, nullif(v_activity ->> 'price', '')::numeric,
      case when v_type = 'drip_buy' then -abs((v_activity ->> 'amount')::numeric) else (v_activity ->> 'amount')::numeric end,
      v_type in ('deposit', 'withdrawal'), v_activity ->> 'description'
    ) returning id into v_entry_id;

    if v_type in ('buy', 'drip_buy') then
      insert into public.lots (account_id, instrument_id, opening_entry_id, acquired_on, original_quantity, remaining_quantity, total_cost_basis, basis_known)
      values (v_import.account_id, v_instrument_id, v_entry_id, (v_activity ->> 'effectiveDate')::date, (v_activity ->> 'quantity')::numeric, (v_activity ->> 'quantity')::numeric, abs((v_activity ->> 'amount')::numeric), true);
    end if;
  end loop;

  update public.imports set status = 'committed', committed_at = now(), updated_at = now() where id = p_import_id;
  insert into public.job_outbox (event_type, payload) values ('import.committed', jsonb_build_object('importId', p_import_id, 'accountId', v_import.account_id));
  return p_import_id;
end;
$$;

revoke all on function public.commit_import(uuid) from public;
grant execute on function public.commit_import(uuid) to authenticated;

drop index public.ledger_entries_import_source_row_unique;
create unique index ledger_entries_import_source_row_type_unique on public.ledger_entries(source_row_id, entry_type) where source_row_id is not null;
