create table public.internal_transfer_reconciliations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  transfer_group_id uuid not null,
  status text not null check (status in ('linked', 'unresolved')),
  incoming_entry_id uuid references public.ledger_entries(id) on delete cascade,
  outgoing_entry_id uuid references public.ledger_entries(id) on delete cascade,
  unresolved_ids uuid[] not null default '{}',
  reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, transfer_group_id),
  check ((status = 'linked' and incoming_entry_id is not null and outgoing_entry_id is not null and reason is null) or (status = 'unresolved' and reason is not null)),
  check (incoming_entry_id is null or incoming_entry_id <> outgoing_entry_id)
);

create index internal_transfer_reconciliations_status_idx on public.internal_transfer_reconciliations(user_id, status);
alter table public.internal_transfer_reconciliations enable row level security;
create policy internal_transfer_reconciliations_owner on public.internal_transfer_reconciliations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.internal_transfer_reconciliations is 'Durable, reproducible matching result for cross-account cash/share transfers. Unresolved groups remain visible and are never treated as external flows.';
