# Backup and restore drill

This procedure is the repository-side recovery contract for checklist task
12.07. It is a procedure and evidence template, not proof that a hosted
restore has already succeeded. Execute it in an isolated Supabase project
before launch and attach the completed evidence to the deployment record.

## Recovery targets

The proposed MVP targets are:

- **RPO: 24 hours.** At most one day of committed transactions, report
  snapshots, and price revisions may be lost after a provider outage.
- **RTO: 4 hours.** A restore should return the API and authenticated dashboard
  to a usable state within four hours of the recovery decision.

The operator must record the actual backup timestamp, restore start/end times,
and measured data loss before accepting these targets for production.

## Drill procedure

1. Record the source Supabase project, database migration revision, Worker
   revision, storage bucket name, and the latest successful report and price
   job timestamps. Export the current database using the Supabase-managed
   backup/export facility; never place credentials or raw brokerage files in
   this repository.
2. Create a temporary isolated Supabase project. Apply migrations in order and
   configure Auth, RLS, Storage policies, and the same server-side secrets as
   the source project using the secret manager. Do not copy production users'
   credentials into logs or test fixtures.
3. Restore the database export into the isolated project. Restore private
   statement objects from the encrypted object-storage backup, preserving
   object paths, hashes, ownership metadata, and the 30-day retention fields.
4. Run the repository checks (`npm run typecheck`, `npm test -- --run`, and
   `npm run build`) against the isolated configuration. Start the API and run
   the authenticated smoke flow: sign in, list an owned account, read a
   report, download an export, and verify that a guessed account ID is denied.
5. Reconcile recovery invariants: transaction counts and hashes, account cash
   totals, open lots, report snapshot revisions, selected price revisions,
   import idempotency keys, deletion-plan state, and audit/outbox records.
   Verify that a user cannot read another user's rows or private objects.
6. Record discrepancies. A missing price must remain unavailable; do not fill
   gaps with synthetic values. If reconciliation fails, destroy the isolated
   project, investigate, and repeat the drill after the corrective migration
   or backup change.

## Evidence record

Complete this table for every drill:

| Field | Value |
| --- | --- |
| Source project and backup ID |  |
| Backup completed at (UTC) |  |
| Source migration revision |  |
| Isolated project |  |
| Restore started / completed (UTC) |  |
| Measured RPO / RTO |  |
| Database, RLS, Storage, Auth checks |  |
| Ledger/report/price reconciliation |  |
| Export and deletion checks |  |
| Operator and reviewer |  |
| Evidence links and follow-up issue |  |

The launch gate remains incomplete until the table is filled from a successful
isolated drill and the evidence is reviewed.
