# Northstar portfolio tracker

Northstar is a US-focused portfolio-tracker prototype. It currently offers a clearly synthetic demo and an in-browser CSV preview only. It has no live account authentication, persistent storage, billing, brokerage connection, or market-price feed.

## Local setup

1. Copy `.env.example` to `.env.local` and leave values blank until the corresponding service is configured.
2. Run `npm install` and `npm run dev`.
3. Run `npm run typecheck`, `npm test`, and `npm run build` before submitting changes.

## Architecture direction

The present UI is a Vinext/Sites application. The planned production system keeps a separate Cloudflare Hono API boundary and uses Supabase over HTTP for authentication, PostgreSQL, and private storage. Financial values cross API boundaries as canonical decimal strings and will be stored as `NUMERIC(38,12)` in PostgreSQL. Economic dates are `YYYY-MM-DD`; system events will use UTC timestamps.

The module boundaries are identity/billing, accounts, ingestion, ledger, calculations, market data, and reporting. The source folders now establish the shared numeric, date, instrument-alias, configuration, and API-health contracts. The API is not mounted until user authentication and database ownership controls are implemented.

## Supabase schema

`supabase/migrations/20260909120000_initial_schema.sql` is the initial PostgreSQL schema. It stores immutable import rows, normalized ledger entries, FIFO lots, price revisions, report snapshots, billing state, audit data, and job-outbox events. It also enables row-level security for user-owned records and creates a private `brokerage-statements` storage bucket. Apply it only to a Supabase development project after its URL and anonymous key are configured; no database credentials belong in this repository.

## Marketstack during development

Marketstack is not called by the application yet. The server-only adapter accepts a `MARKETSTACK_API_KEY` and a request-budget implementation; it queries the EOD endpoint once per unique symbol and normalizes close prices as decimal strings. Connect it to the scheduled job only after the price database and job persistence exist. For development, use a conservative cap below the official free-plan 100 monthly requests. Production configuration requires a commercial plan and rights review before any public release.
