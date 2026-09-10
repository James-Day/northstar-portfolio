-- Derived reports, accounting projections, and webhook history are written by
-- trusted server workflows. Authenticated clients may read their own rows
-- through RLS, but guessed IDs and direct table writes must never mutate them.
revoke all on public.billing_webhook_events from public, anon, authenticated;
grant select on public.billing_webhook_events to authenticated;

revoke all on public.report_snapshots from public, anon, authenticated;
grant select on public.report_snapshots to authenticated;

revoke all on public.lot_matches from public, anon, authenticated;
grant select on public.lot_matches to authenticated;

revoke all on public.internal_transfer_reconciliations from public, anon, authenticated;
grant select on public.internal_transfer_reconciliations to authenticated;
