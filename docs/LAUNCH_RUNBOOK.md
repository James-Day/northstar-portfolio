# Launch and rollback runbook

This runbook is required evidence for checklist items 13.04 and 13.08. The
preflight command validates the repository-side portion; an operator must fill
in the hosted evidence below during staging and before a paid launch.

The backup and restore drill procedure is maintained separately in
`docs/BACKUP_RESTORE_DRILL.md`. A successful isolated drill is required before
claiming recovery readiness.

## Preflight

Run `npm run preflight:launch` with the target environment variables loaded.
The command prints check IDs and messages only; it never prints secret values.
Resolve every `fail`. A `warn` is acceptable for staging but must be resolved
for production when the check concerns billing or market-data rights.

Record the following in the deployment ticket:

- Supabase project, migration revision, Auth redirect origins, and Storage
  bucket/policy verification.
- Cloudflare Worker deployment revision, queue names, consumer bindings, DLQs,
  cron schedule, and secret names.
- Stripe webhook endpoint/signature verification, monthly and annual price IDs,
  trial behavior, and Billing Portal test result.
- Marketstack plan, commercial-use evidence, monthly cap, and last successful
  daily refresh.
- Passing authenticated browser, RLS, import, deletion, and restore tests.

## Rollback

1. Disable the Worker cron or route traffic to the last known-good Worker
   revision. Stop queue consumers if they could write incompatible data.
2. Preserve the deployment revision, queue message IDs, job IDs, and error logs.
3. If a migration changed schema or behavior, apply the reviewed down/forward
   recovery migration. Never edit an already-applied migration in place.
4. Re-run the report and price freshness checks against the last known-good
   revision, then replay only idempotent queued jobs after the data boundary is
   confirmed.
5. Restore the previous Worker revision, verify auth, uploads, imports, billing
   webhooks, and dashboard reads, and record the result.
6. Open a follow-up for the failed deployment; do not invite paying users until
   the preflight and rollback evidence are complete.

The rollback owner must record the timestamp, deployed revisions, migration
revisions, affected queue messages, recovery command or migration, verification
results, and the person who approved re-enabling traffic.
