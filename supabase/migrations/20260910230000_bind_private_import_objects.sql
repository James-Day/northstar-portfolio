-- Bind only a verified private Storage object to its staged import.
alter table public.imports add column if not exists storage_object_sha256 char(64);
alter table public.imports add column if not exists storage_object_size bigint;
alter table public.imports add constraint imports_storage_object_metadata_check check (
  (storage_object_path is null and storage_object_sha256 is null and storage_object_size is null)
  or (storage_object_path is not null and storage_object_sha256 ~ '^[0-9a-f]{64}$' and storage_object_size > 0)
);

create or replace function public.bind_import_object(
  p_import_id uuid,
  p_account_id uuid,
  p_storage_object_path text,
  p_storage_object_sha256 text,
  p_storage_object_size bigint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.imports%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if p_storage_object_path is null or p_storage_object_path !~ ('^' || auth.uid()::text || '/' || p_account_id::text || '/[^/]+$')
    or p_storage_object_path ~ '[\\]\.\.?(/|$)' then
    raise exception 'Storage object path is invalid.' using errcode = '22023';
  end if;
  if p_storage_object_sha256 !~ '^[0-9a-f]{64}$' or p_storage_object_size <= 0 or p_storage_object_size > 10485760 then
    raise exception 'Storage object metadata is invalid.' using errcode = '22023';
  end if;
  select i.* into v_import from public.imports i join public.accounts a on a.id = i.account_id
    where i.id = p_import_id and i.account_id = p_account_id and a.user_id = auth.uid() for update;
  if not found then raise exception 'Import not found.' using errcode = '42501'; end if;
  if v_import.file_sha256 <> p_storage_object_sha256 then raise exception 'Storage object hash does not match the staged import.' using errcode = '22023'; end if;
  if v_import.storage_object_path is not null and v_import.storage_object_path <> p_storage_object_path then raise exception 'Import is already bound to another object.' using errcode = '23505'; end if;
  update public.imports set storage_object_path = p_storage_object_path, storage_object_sha256 = p_storage_object_sha256, storage_object_size = p_storage_object_size, updated_at = now() where id = p_import_id;
end;
$$;

revoke all on function public.bind_import_object(uuid, uuid, text, text, bigint) from public;
grant execute on function public.bind_import_object(uuid, uuid, text, text, bigint) to authenticated;
