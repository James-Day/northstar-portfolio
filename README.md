# Northstar portfolio tracker

Northstar is a US-focused portfolio-tracker prototype. It currently offers a clearly synthetic demo plus authenticated Robinhood CSV staging and review. Real reporting, billing, and production market-data operations remain gated behind the checklist.

## Local setup

1. Copy `.env.example` to `.env.local` and leave values blank until the corresponding service is configured.
2. Run `npm install` and `npm run dev`.
3. Run `npm run typecheck`, `npm test`, and `npm run build` before submitting changes.

For a local database reset, install the Supabase CLI and Docker Desktop, then
run `supabase start` followed by `supabase db reset` from this repository. The
reset applies every migration and the deterministic `supabase/seed.sql`
fixtures; it does not touch a hosted project. Use the local Auth API to create
two test users and verify that each can see only its own accounts before
running authenticated browser tests.

The repeatable harness runs the same reset and creates two temporary Auth
users. Run `npm run integration:local -- --with-app --with-browser --keep` to
start the local API on `http://127.0.0.1:8787` and the frontend on
`http://localhost:3000`, then leave both services available for manual testing.
Stop the harness with Ctrl+C and stop Supabase with `npx supabase stop` when
you are finished. Process output is bounded and credentials are redacted. If
Docker is unavailable, the harness preserves the Supabase CLI diagnostic and
exits without attempting unsafe Docker repairs.

Run `npm run integration:local -- --rls` for the live database boundary probe.
It uses two temporary Auth sessions to test owner reads, guessed-ID isolation,
cross-user update/delete denial, invalid-session denial, private Storage access,
and service-only global reference writes. The probe removes its temporary users
and uploaded object on completion. A successful run is required before marking
the live RLS checklist gates complete.

## Architecture direction

The present UI is a Vinext/Sites application. The planned production system keeps a separate Cloudflare Hono API boundary and uses Supabase over HTTP for authentication, PostgreSQL, and private storage. Financial values cross API boundaries as canonical decimal strings and will be stored as `NUMERIC(38,12)` in PostgreSQL. Economic dates are `YYYY-MM-DD`; system events will use UTC timestamps.

The module boundaries are identity/billing, accounts, ingestion, ledger, calculations, market data, and reporting. `services/module-boundaries.ts` is the public composition contract: storage, provider, and HTTP adapters implement ports there, while domain modules do not depend on the UI. The source folders also establish the shared numeric, date, instrument-alias, configuration, and API-health contracts. The API is not mounted until user authentication and database ownership controls are implemented.

## Supabase schema

`supabase/migrations/20260909120000_initial_schema.sql` is the initial PostgreSQL schema. It stores immutable import rows, normalized ledger entries, FIFO lots, price revisions, report snapshots, billing state, audit data, and job-outbox events. It also enables row-level security for user-owned records and creates a private `brokerage-statements` storage bucket. Apply it only to a Supabase development project after its URL and anonymous key are configured; no database credentials belong in this repository.

## Marketstack during development

The Worker’s scheduled handler now composes active-symbol discovery, the server-only Marketstack adapter, Supabase price persistence, retries, and durable job metrics. The hourly weekday cron is guarded by New York market-session rules and an explicit `MARKETSTACK_SCHEDULE_ENABLED=true` opt-in; a key alone cannot activate it. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MARKETSTACK_API_KEY` as Worker secrets; keep `MARKETSTACK_MONTHLY_CAP` at or below the verified allowance (the local default is 100). See `docs/MARKETSTACK_DEVELOPMENT.md` for the no-secret status check and one-symbol smoke procedure. Production configuration requires a commercial plan and rights review before any public release.

The API deployment also declares separate Cloudflare Queues for import processing, report publication, and price work. These queues provide durable handoff points for the next background-processing increments; request handlers remain the source of truth until queue consumers are implemented and exercised.
