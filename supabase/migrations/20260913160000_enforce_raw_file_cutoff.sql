-- A retention claim must never make a newly uploaded statement eligible early.
-- Keep the 30-day policy in the durable database boundary as a second line of
-- defense, even if a caller supplies an incorrect available_at value.
update public.raw_file_retention
set available_at = uploaded_at + interval '30 days'
where status = 'pending';

create or replace function public.sync_raw_file_retention()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.storage_object_path is not null and (tg_op = 'INSERT' or old.storage_object_path is distinct from new.storage_object_path) then
    insert into public.raw_file_retention (import_id, object_path, uploaded_at, available_at)
    values (new.id, new.storage_object_path, new.created_at, new.created_at + interval '30 days')
    on conflict (import_id) do update set object_path = excluded.object_path, updated_at = now()
      where raw_file_retention.status <> 'deleted';
  end if;
  return new;
end;
$$;

create or replace function public.claim_raw_file_retention(p_limit integer default 100, p_now timestamptz default now(), p_max_attempts integer default 8)
returns table(id uuid, import_id uuid, object_path text, uploaded_at timestamptz, deleted_at timestamptz, attempts integer)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select r.id
    from public.raw_file_retention r
    where r.attempts < greatest(1, p_max_attempts)
      and ((r.status = 'pending' and r.available_at <= p_now and r.uploaded_at <= p_now - interval '30 days')
        or (r.status = 'deleting' and r.claimed_at < p_now - interval '15 minutes'))
    order by r.uploaded_at, r.id
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update public.raw_file_retention r
  set status = 'deleting', attempts = r.attempts + 1, claimed_at = p_now, updated_at = p_now
  from candidates c
  where r.id = c.id
  returning r.id, r.import_id, r.object_path, r.uploaded_at, r.deleted_at, r.attempts;
end;
$$;

