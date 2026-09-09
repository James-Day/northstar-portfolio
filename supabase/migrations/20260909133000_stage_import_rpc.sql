create or replace function public.stage_import(
  p_account_id uuid,
  p_file_name text,
  p_file_sha256 text,
  p_parser_version text,
  p_source_rows jsonb,
  p_activity_from date,
  p_activity_through date,
  p_usable_row_count integer,
  p_warning_count integer
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import_id uuid;
  v_row jsonb;
  v_row_number integer;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id and user_id = auth.uid()) then
    raise exception 'Account not found.' using errcode = '42501';
  end if;
  if length(p_file_name) not between 5 and 255
    or right(p_file_name, 4) <> '.csv'
    or position('/' in p_file_name) > 0
    or position(chr(92) in p_file_name) > 0
    or p_file_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid CSV file name.' using errcode = '22023';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid statement SHA-256.' using errcode = '22023';
  end if;
  if p_parser_version = '' then
    raise exception 'Parser version is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_source_rows) <> 'array' or jsonb_array_length(p_source_rows) = 0 then
    raise exception 'At least one source row is required.' using errcode = '22023';
  end if;
  if p_activity_from is not null and p_activity_through is not null and p_activity_through < p_activity_from then
    raise exception 'Activity range is invalid.' using errcode = '22023';
  end if;
  if p_usable_row_count < 0 or p_warning_count < 0
    or p_usable_row_count > jsonb_array_length(p_source_rows)
    or p_warning_count > jsonb_array_length(p_source_rows) then
    raise exception 'Import counts are invalid.' using errcode = '22023';
  end if;

  insert into public.imports (
    account_id, status, file_name, file_sha256, parser_version,
    source_row_count, usable_row_count, warning_count, activity_from, activity_through
  ) values (
    p_account_id, 'ready_for_review', p_file_name, p_file_sha256, p_parser_version,
    jsonb_array_length(p_source_rows), p_usable_row_count, p_warning_count, p_activity_from, p_activity_through
  ) returning id into v_import_id;

  for v_row in select value from jsonb_array_elements(p_source_rows)
  loop
    v_row_number := (v_row ->> 'rowNumber')::integer;
    v_status := v_row ->> 'status';
    if v_row_number is null or v_row_number < 2 then
      raise exception 'Invalid source-row number.' using errcode = '22023';
    end if;
    if v_status not in ('supported', 'unsupported', 'invalid', 'duplicate') then
      raise exception 'Invalid source-row status.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_row -> 'raw') <> 'object' then
      raise exception 'Source row must retain its raw CSV object.' using errcode = '22023';
    end if;
    insert into public.import_source_rows (import_id, row_number, raw_row, normalized_payload, parse_status, message)
    values (
      v_import_id,
      v_row_number,
      v_row -> 'raw',
      case when v_row ? 'activity' then v_row -> 'activity' else null end,
      v_status,
      nullif(v_row ->> 'message', '')
    );
  end loop;

  return v_import_id;
end;
$$;

revoke all on function public.stage_import(uuid, text, text, text, jsonb, date, date, integer, integer) from public;
grant execute on function public.stage_import(uuid, text, text, text, jsonb, date, date, integer, integer) to authenticated;
