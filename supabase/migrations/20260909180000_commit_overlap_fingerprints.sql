-- Persist the same SHA-256 canonicalization used by the importer. A fingerprint
-- belongs to the primary ledger event for a source row; DRIP's derived dividend
-- event deliberately has no fingerprint so one source activity counts once.
update public.ledger_entries l
set fingerprint = encode(
  extensions.digest(
    concat_ws(
      chr(31),
      l.account_id::text,
      r.normalized_payload ->> 'effectiveDate',
      r.normalized_payload ->> 'type',
      upper(btrim(coalesce(r.normalized_payload ->> 'symbol', ''))),
      coalesce(r.normalized_payload ->> 'quantity', ''),
      coalesce(r.normalized_payload ->> 'price', ''),
      r.normalized_payload ->> 'amount',
      regexp_replace(btrim(coalesce(r.normalized_payload ->> 'description', '')), '\s+', ' ', 'g')
    ),
    'sha256'
  ),
  'hex'
)
from public.import_source_rows r
where l.source_row_id = r.id
  and l.entry_type = r.normalized_payload ->> 'type'
  and r.parse_status = 'supported'
  and l.fingerprint is null;

create or replace function public.commit_import(p_import_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_import public.imports%rowtype;
  v_row public.import_source_rows%rowtype;
  v_activity jsonb;
  v_type text;
  v_instrument_id uuid;
  v_entry_id uuid;
  v_fingerprint text;
  v_existing_count integer;
  v_consumed_count integer;
  v_seen_fingerprints jsonb := '{}'::jsonb;
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

    v_fingerprint := encode(
      digest(
        concat_ws(
          chr(31),
          v_import.account_id::text,
          v_activity ->> 'effectiveDate',
          v_type,
          upper(btrim(coalesce(v_activity ->> 'symbol', ''))),
          coalesce(v_activity ->> 'quantity', ''),
          coalesce(v_activity ->> 'price', ''),
          v_activity ->> 'amount',
          regexp_replace(btrim(coalesce(v_activity ->> 'description', '')), '\s+', ' ', 'g')
        ),
        'sha256'
      ),
      'hex'
    );
    select count(*) into v_existing_count
    from public.ledger_entries
    where account_id = v_import.account_id
      and fingerprint = v_fingerprint
      and import_id is distinct from p_import_id;
    v_consumed_count := coalesce((v_seen_fingerprints ->> v_fingerprint)::integer, 0);
    if v_consumed_count < v_existing_count then
      v_seen_fingerprints := jsonb_set(v_seen_fingerprints, array[v_fingerprint], to_jsonb(v_consumed_count + 1));
      update public.import_source_rows set parse_status = 'duplicate', message = 'Duplicate of activity already committed in this account.' where id = v_row.id;
      continue;
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

    insert into public.ledger_entries (account_id, import_id, source_row_id, effective_date, entry_type, instrument_id, quantity, unit_price, cash_amount, external_flow, description, fingerprint)
    values (
      v_import.account_id, p_import_id, v_row.id, (v_activity ->> 'effectiveDate')::date, v_type, v_instrument_id,
      nullif(v_activity ->> 'quantity', '')::numeric, nullif(v_activity ->> 'price', '')::numeric,
      case when v_type = 'drip_buy' then -abs((v_activity ->> 'amount')::numeric) else (v_activity ->> 'amount')::numeric end,
      v_type in ('deposit', 'withdrawal'), v_activity ->> 'description', v_fingerprint
    ) returning id into v_entry_id;

    if v_type in ('buy', 'drip_buy') then
      insert into public.lots (account_id, instrument_id, opening_entry_id, acquired_on, original_quantity, remaining_quantity, total_cost_basis, basis_known)
      values (v_import.account_id, v_instrument_id, v_entry_id, (v_activity ->> 'effectiveDate')::date, (v_activity ->> 'quantity')::numeric, (v_activity ->> 'quantity')::numeric, abs((v_activity ->> 'amount')::numeric), true);
    end if;
    v_seen_fingerprints := jsonb_set(v_seen_fingerprints, array[v_fingerprint], to_jsonb(v_consumed_count + 1));
  end loop;

  update public.imports set status = 'committed', committed_at = now(), updated_at = now() where id = p_import_id;
  insert into public.job_outbox (event_type, payload) values ('import.committed', jsonb_build_object('importId', p_import_id, 'accountId', v_import.account_id));
  return p_import_id;
end;
$$;
