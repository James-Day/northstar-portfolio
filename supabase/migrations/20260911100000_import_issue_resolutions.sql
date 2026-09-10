-- Durable, auditable import issue resolutions. A resolution is scoped to the
-- import and optional immutable source row; it never deletes or rewrites evidence.
create table if not exists public.import_issue_resolutions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete restrict,
  source_row_id uuid references public.import_source_rows(id) on delete restrict,
  issue_code text not null check (issue_code in ('unsupported_row','missing_instrument_alias','incomplete_history')),
  resolution_kind text not null check (resolution_kind in ('non_reportable','alias_confirmed','history_acknowledged')),
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  resolved_by uuid not null references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  unique (import_id, source_row_id, issue_code),
  check ((issue_code = 'unsupported_row' and resolution_kind = 'non_reportable') or
    (issue_code = 'missing_instrument_alias' and resolution_kind = 'alias_confirmed') or
    (issue_code = 'incomplete_history' and resolution_kind = 'history_acknowledged'))
);

alter table public.import_issue_resolutions enable row level security;
create policy import_issue_resolutions_owner on public.import_issue_resolutions for all
  using (exists (select 1 from public.imports i join public.accounts a on a.id = i.account_id where i.id = import_id and a.user_id = auth.uid()))
  with check (resolved_by = auth.uid() and exists (select 1 from public.imports i join public.accounts a on a.id = i.account_id where i.id = import_id and a.user_id = auth.uid()));
create index if not exists import_issue_resolutions_import_idx on public.import_issue_resolutions(import_id);

create or replace function public.validate_import_issue_resolution() returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text; v_import_id uuid;
begin
  if new.source_row_id is not null then
    select r.import_id, r.parse_status into v_import_id, v_status from public.import_source_rows r where r.id = new.source_row_id;
    if v_import_id is null or v_import_id <> new.import_id then raise exception 'Source row does not belong to this import.' using errcode = '22023'; end if;
    if new.issue_code = 'unsupported_row' and v_status <> 'unsupported' then raise exception 'Source row is not unsupported.' using errcode = '22023'; end if;
    if new.issue_code = 'missing_instrument_alias' and v_status <> 'supported' then raise exception 'Alias issue requires a supported source row.' using errcode = '22023'; end if;
    if new.issue_code = 'incomplete_history' then raise exception 'Incomplete history is account-scoped.' using errcode = '22023'; end if;
  elsif new.issue_code <> 'incomplete_history' then
    raise exception 'This issue requires a source row.' using errcode = '22023';
  end if;
  return new;
end; $$;
drop trigger if exists validate_import_issue_resolution on public.import_issue_resolutions;
create trigger validate_import_issue_resolution before insert or update on public.import_issue_resolutions for each row execute function public.validate_import_issue_resolution();

create or replace function public.validate_import_issue_resolutions(p_import_id uuid) returns void language plpgsql security invoker set search_path = public as $$
begin
  if exists (select 1 from public.import_source_rows r where r.import_id = p_import_id and r.parse_status in ('invalid','unsupported') and not exists (select 1 from public.import_issue_resolutions ir where ir.import_id = p_import_id and ir.source_row_id = r.id and ir.resolution_kind = 'non_reportable')) then
    raise exception 'Resolve invalid or unsupported rows before committing.' using errcode = '22023';
  end if;
end; $$;
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
  from public.import_source_rows r
  where r.import_id = p_import_id
    and not exists (select 1 from public.import_issue_resolutions ir where ir.import_id = p_import_id and ir.source_row_id = r.id and ir.resolution_kind = 'non_reportable');

  if v_supported_count = 0 or v_invalid_count > 0 or v_unsupported_count > 0 then
    raise exception 'Resolve invalid or unsupported rows before committing.' using errcode = '22023';
  end if;

  for v_row in select * from public.import_source_rows where import_id = p_import_id and parse_status = 'supported' order by row_number
  loop
    v_activity := v_row.normalized_payload;
    v_type := v_activity ->> 'type';
    if v_activity is null or v_type not in ('buy', 'sell', 'dividend', 'drip_buy', 'interest', 'fee', 'deposit', 'withdrawal', 'ira_incentive', 'transfer_in', 'transfer_out', 'split') then
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
    if v_type in ('buy', 'sell', 'dividend', 'drip_buy', 'split') then
      select ia.instrument_id into v_instrument_id
      from public.instrument_aliases ia
      where ia.symbol = upper(v_activity ->> 'symbol')
        and ia.effective_from <= (v_activity ->> 'effectiveDate')::date
        and (ia.effective_to is null or ia.effective_to >= (v_activity ->> 'effectiveDate')::date);
      if v_instrument_id is null then
        raise exception 'No stable instrument alias exists for source row %.', v_row.row_number using errcode = '22023';
      end if;
    end if;

    if v_type = 'split' then
      if (v_activity -> 'corporateAction') is null
         or nullif(v_activity #>> '{corporateAction,ratioNumerator}', '') is null
         or nullif(v_activity #>> '{corporateAction,ratioDenominator}', '') is null then
        raise exception 'Split source row % is missing an inferred ratio.' using errcode = '22023';
      end if;
      select count(*) into v_existing_count
      from public.corporate_actions
      where instrument_id = v_instrument_id
        and action_date = (v_activity ->> 'effectiveDate')::date
        and ratio_numerator = (v_activity #>> '{corporateAction,ratioNumerator}')::numeric
        and ratio_denominator = (v_activity #>> '{corporateAction,ratioDenominator}')::numeric
        and source = 'robinhood_csv';
      if v_existing_count > 0 then
        update public.import_source_rows set parse_status = 'duplicate', message = 'Duplicate corporate action already committed in this account.' where id = v_row.id;
        continue;
      end if;
      insert into public.corporate_actions (instrument_id, action_date, action_type, ratio_numerator, ratio_denominator, source, source_revision, status, evidence)
      values (v_instrument_id, (v_activity ->> 'effectiveDate')::date, 'split',
        (v_activity #>> '{corporateAction,ratioNumerator}')::numeric,
        (v_activity #>> '{corporateAction,ratioDenominator}')::numeric,
        'robinhood_csv', v_import.parser_version, 'validated',
        'Inferred from pre-split position and Robinhood SPL activity row: ' || coalesce(v_activity ->> 'description', ''));
      v_seen_fingerprints := jsonb_set(v_seen_fingerprints, array[v_fingerprint], to_jsonb(v_consumed_count + 1));
      continue;
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

create or replace function public.commit_import(p_import_id uuid)
returns uuid language plpgsql security invoker set search_path = public, extensions as $$
declare v_account_id uuid;
begin
  select i.account_id into v_account_id from public.imports i join public.accounts a on a.id = i.account_id where i.id = p_import_id and a.user_id = auth.uid();
  if not found then raise exception 'Import not found.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  perform public.validate_import_issue_resolutions(p_import_id);
  return public.commit_import_unlocked(p_import_id);
end; $$;

revoke all on function public.validate_import_issue_resolutions(uuid) from public, anon, authenticated;
revoke all on function public.validate_import_issue_resolution() from public, anon, authenticated;
revoke all on function public.commit_import_unlocked(uuid) from public;
grant execute on function public.commit_import_unlocked(uuid) to authenticated;
revoke all on function public.commit_import(uuid) from public;
grant execute on function public.commit_import(uuid) to authenticated;
