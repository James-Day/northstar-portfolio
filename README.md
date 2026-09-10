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

## Architecture direction

The present UI is a Vinext/Sites application. The planned production system keeps a separate Cloudflare Hono API boundary and uses Supabase over HTTP for authentication, PostgreSQL, and private storage. Financial values cross API boundaries as canonical decimal strings and will be stored as `NUMERIC(38,12)` in PostgreSQL. Economic dates are `YYYY-MM-DD`; system events will use UTC timestamps.

The module boundaries are identity/billing, accounts, ingestion, ledger, calculations, market data, and reporting. `services/module-boundaries.ts` is the public composition contract: storage, provider, and HTTP adapters implement ports there, while domain modules do not depend on the UI. The source folders also establish the shared numeric, date, instrument-alias, configuration, and API-health contracts. The API is not mounted until user authentication and database ownership controls are implemented.

## Supabase schema

`supabase/migrations/20260909120000_initial_schema.sql` is the initial PostgreSQL schema. It stores immutable import rows, normalized ledger entries, FIFO lots, price revisions, report snapshots, billing state, audit data, and job-outbox events. It also enables row-level security for user-owned records and creates a private `brokerage-statements` storage bucket. Apply it only to a Supabase development project after its URL and anonymous key are configured; no database credentials belong in this repository.

## Marketstack during development

The Worker’s scheduled handler now composes active-symbol discovery, the server-only Marketstack adapter, Supabase price persistence, retries, and durable job metrics. The hourly weekday cron is guarded by New York market-session rules. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MARKETSTACK_API_KEY` as Worker secrets; keep `MARKETSTACK_MONTHLY_CAP` at or below the verified allowance (the local default is 100). Production configuration requires a commercial plan and rights review before any public release.

The API deployment also declares separate Cloudflare Queues for import processing, report publication, and price work. These queues provide durable handoff points for the next background-processing increments; request handlers remain the source of truth until queue consumers are implemented and exercised.
