-- Lots are a derived projection of the committed ledger. Rebuild the whole
-- account projection after every import mutation so a sale cannot leave the
-- persisted lots out of sync with the chronological FIFO calculation.
create table public.lot_matches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  sale_entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  lot_id uuid not null references public.lots(id) on delete cascade,
  quantity numeric(38,12) not null check (quantity > 0),
  cost_basis numeric(38,12),
  basis_known boolean not null default true,
  created_at timestamptz not null default now(),
  check ((basis_known and cost_basis is not null) or not basis_known)
);
create index lot_matches_account_sale_idx on public.lot_matches(account_id, sale_entry_id);
alter table public.lot_matches enable row level security;
create policy lot_matches_owner on public.lot_matches for all
  using (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid()));

create or replace function public.rebuild_account_lots(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entry public.ledger_entries%rowtype;
  v_lot public.lots%rowtype;
  v_remaining numeric;
  v_matched numeric;
  v_basis numeric;
begin
  -- The caller already holds the account advisory lock. Replacing both
  -- projections in one transaction makes retries and undo deterministic.
  delete from public.lot_matches where account_id = p_account_id;
  delete from public.lots where account_id = p_account_id;

  for v_entry in
    select e.*
    from public.ledger_entries e
    join public.imports i on i.id = e.import_id and i.status = 'committed'
    where e.account_id = p_account_id
      and e.entry_type in ('buy', 'drip_buy', 'sell')
    order by e.effective_date asc, e.id asc
  loop
    if v_entry.entry_type in ('buy', 'drip_buy') then
      insert into public.lots (
        account_id, instrument_id, opening_entry_id, acquired_on,
        original_quantity, remaining_quantity, total_cost_basis, basis_known
      ) values (
        p_account_id, v_entry.instrument_id, v_entry.id, v_entry.effective_date,
        v_entry.quantity, v_entry.quantity, abs(v_entry.cash_amount), true
      );
    else
      v_remaining := v_entry.quantity;
      for v_lot in
        select l.* from public.lots l
        where l.account_id = p_account_id
          and l.instrument_id = v_entry.instrument_id
          and l.remaining_quantity > 0
        order by l.acquired_on asc nulls first, l.opening_entry_id asc nulls last, l.id asc
        for update
      loop
        exit when v_remaining <= 0;
        v_matched := least(v_lot.remaining_quantity, v_remaining);
        v_basis := null;
        if v_lot.basis_known and v_lot.total_cost_basis is not null then
          v_basis := v_lot.total_cost_basis * v_matched / nullif(v_lot.original_quantity, 0);
        end if;
        insert into public.lot_matches (
          account_id, sale_entry_id, lot_id, quantity, cost_basis, basis_known
        ) values (
          p_account_id, v_entry.id, v_lot.id, v_matched, v_basis, v_basis is not null
        );
        update public.lots
        set remaining_quantity = remaining_quantity - v_matched
        where id = v_lot.id;
        v_remaining := v_remaining - v_matched;
      end loop;
      if v_remaining > 0 then
        raise exception 'Sell % exceeds available lots by %.', v_entry.id, v_remaining
          using errcode = '22023';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.rebuild_account_lots(uuid) from public;
grant execute on function public.rebuild_account_lots(uuid) to authenticated;

-- The wrappers are the account-serialized mutation boundary established by
-- the preceding migration. Rebuild only after the underlying mutation has
-- succeeded, while the same transaction-scoped advisory lock is held.
create or replace function public.commit_import(p_import_id uuid)
returns uuid language plpgsql security invoker
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_result uuid;
begin
  select i.account_id into v_account_id from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid();
  if not found then raise exception 'Import not found.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  v_result := public.commit_import_unlocked(p_import_id);
  perform public.rebuild_account_lots(v_account_id);
  return v_result;
end;
$$;

create or replace function public.undo_import(p_import_id uuid)
returns uuid language plpgsql security invoker
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_result uuid;
begin
  select i.account_id into v_account_id from public.imports i
  join public.accounts a on a.id = i.account_id
  where i.id = p_import_id and a.user_id = auth.uid();
  if not found then raise exception 'Import not found.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text, 0));
  v_result := public.undo_import_unlocked(p_import_id);
  perform public.rebuild_account_lots(v_account_id);
  return v_result;
end;
$$;

revoke all on function public.commit_import(uuid) from public;
grant execute on function public.commit_import(uuid) to authenticated;
revoke all on function public.undo_import(uuid) from public;
grant execute on function public.undo_import(uuid) to authenticated;
