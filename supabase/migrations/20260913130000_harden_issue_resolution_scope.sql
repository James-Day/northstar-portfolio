-- Keep account-scoped incomplete-history acknowledgements durable and tied to
-- the explicit opening-history disclosure. Also make the nullable source row
-- key unique for account-scoped issues; PostgreSQL otherwise permits multiple
-- NULL values through a normal UNIQUE constraint.
create unique index if not exists import_issue_resolutions_account_issue_unique
  on public.import_issue_resolutions(import_id, issue_code)
  where source_row_id is null;

create or replace function public.validate_import_issue_resolution()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_status text;
  v_import_id uuid;
  v_account_id uuid;
begin
  select r.import_id, r.parse_status
    into v_import_id, v_status
    from public.import_source_rows r
   where r.id = new.source_row_id;

  if new.source_row_id is not null then
    if v_import_id is null or v_import_id <> new.import_id then
      raise exception 'Source row does not belong to this import.' using errcode = '22023';
    end if;
    if new.issue_code = 'unsupported_row' and v_status <> 'unsupported' then
      raise exception 'Source row is not unsupported.' using errcode = '22023';
    end if;
    if new.issue_code = 'missing_instrument_alias' and v_status <> 'supported' then
      raise exception 'Alias issue requires a supported source row.' using errcode = '22023';
    end if;
    if new.issue_code = 'incomplete_history' then
      raise exception 'Incomplete history is account-scoped.' using errcode = '22023';
    end if;
  elsif new.issue_code <> 'incomplete_history' then
    raise exception 'This issue requires a source row.' using errcode = '22023';
  else
    select i.account_id into v_account_id
      from public.imports i
     where i.id = new.import_id;
    if v_account_id is null or not exists (
      select 1
        from public.account_opening_history h
       where h.account_id = v_account_id
         and char_length(btrim(coalesce(h.incomplete_reason, ''))) >= 3
    ) then
      raise exception 'Incomplete-history acknowledgement requires an explicit opening-history explanation.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_import_issue_resolution on public.import_issue_resolutions;
create trigger validate_import_issue_resolution
before insert or update on public.import_issue_resolutions
for each row execute function public.validate_import_issue_resolution();

revoke all on function public.validate_import_issue_resolution() from public, anon, authenticated;
