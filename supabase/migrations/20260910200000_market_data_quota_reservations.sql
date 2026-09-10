-- Keep in-flight Marketstack requests inside the monthly cap. Job-run rows are
-- an audit trail; this ledger is the serialized admission-control boundary.
create table public.market_data_quota_buckets (
  month_start date primary key,
  monthly_cap integer not null check (monthly_cap > 0),
  reserved_units integer not null default 0 check (reserved_units >= 0),
  consumed_units integer not null default 0 check (consumed_units >= 0)
);

create table public.market_data_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  month_start date not null references public.market_data_quota_buckets(month_start),
  idempotency_key text not null unique,
  reserved_units integer not null check (reserved_units >= 0),
  consumed_units integer,
  status text not null default 'reserved' check (status in ('reserved', 'reconciled')),
  created_at timestamptz not null default now(),
  reconciled_at timestamptz
);

alter table public.market_data_quota_buckets enable row level security;
alter table public.market_data_quota_reservations enable row level security;
revoke all on public.market_data_quota_buckets, public.market_data_quota_reservations from anon, authenticated;

create or replace function public.reserve_market_data_quota(
  p_month_start date, p_units integer, p_monthly_cap integer, p_idempotency_key text
)
returns table(reservation_id uuid, reserved_units integer)
language plpgsql security definer set search_path = public
as $$
declare v_bucket public.market_data_quota_buckets%rowtype; v_existing public.market_data_quota_reservations%rowtype; v_id uuid;
begin
  if p_month_start is null or p_units is null or p_units < 0 or p_monthly_cap is null or p_monthly_cap < 1 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'Invalid market-data quota reservation.' using errcode = '22023'; end if;
  select * into v_existing from public.market_data_quota_reservations where idempotency_key = p_idempotency_key;
  if found then reservation_id := v_existing.id; reserved_units := v_existing.reserved_units; return next; return; end if;
  insert into public.market_data_quota_buckets(month_start, monthly_cap) values (p_month_start, p_monthly_cap) on conflict (month_start) do nothing;
  select * into v_bucket from public.market_data_quota_buckets where month_start = p_month_start for update;
  if v_bucket.monthly_cap <> p_monthly_cap then raise exception 'Monthly quota cap changed for an active month.' using errcode = '22023'; end if;
  if v_bucket.consumed_units + v_bucket.reserved_units + p_units > v_bucket.monthly_cap then raise exception 'Market-data monthly quota exhausted.' using errcode = '53200'; end if;
  insert into public.market_data_quota_reservations(month_start, idempotency_key, reserved_units) values (p_month_start, p_idempotency_key, p_units) returning id into v_id;
  update public.market_data_quota_buckets set reserved_units = reserved_units + p_units where month_start = p_month_start;
  reservation_id := v_id; reserved_units := p_units; return next;
end;
$$;

create or replace function public.reconcile_market_data_quota(p_reservation_id uuid, p_consumed_units integer)
returns table(reservation_id uuid, reserved_units integer, consumed_units integer, released_units integer)
language plpgsql security definer set search_path = public
as $$
declare v_reservation public.market_data_quota_reservations%rowtype; v_released integer;
begin
  if p_reservation_id is null or p_consumed_units is null or p_consumed_units < 0 then raise exception 'Invalid market-data quota reconciliation.' using errcode = '22023'; end if;
  select * into v_reservation from public.market_data_quota_reservations where id = p_reservation_id for update;
  if not found then raise exception 'Market-data quota reservation not found.' using errcode = 'P0002'; end if;
  if v_reservation.status = 'reconciled' then reservation_id := v_reservation.id; reserved_units := v_reservation.reserved_units; consumed_units := v_reservation.consumed_units; released_units := v_reservation.reserved_units - v_reservation.consumed_units; return next; return; end if;
  if p_consumed_units > v_reservation.reserved_units then raise exception 'Consumed quota exceeds reservation.' using errcode = '22023'; end if;
  v_released := v_reservation.reserved_units - p_consumed_units;
  update public.market_data_quota_buckets set reserved_units = reserved_units - v_reservation.reserved_units, consumed_units = consumed_units + p_consumed_units where month_start = v_reservation.month_start;
  update public.market_data_quota_reservations set consumed_units = p_consumed_units, status = 'reconciled', reconciled_at = now() where id = v_reservation.id;
  reservation_id := v_reservation.id; reserved_units := v_reservation.reserved_units; consumed_units := p_consumed_units; released_units := v_released; return next;
end;
$$;

revoke all on function public.reserve_market_data_quota(date, integer, integer, text) from public;
revoke all on function public.reconcile_market_data_quota(uuid, integer) from public;
grant execute on function public.reserve_market_data_quota(date, integer, integer, text) to service_role;
grant execute on function public.reconcile_market_data_quota(uuid, integer) to service_role;
