# Northstar portfolio tracker

Northstar is a US-focused portfolio-tracker prototype. It currently offers a clearly synthetic demo and an in-browser CSV preview only. It has no live account authentication, persistent storage, billing, brokerage connection, or market-price feed.

## Local setup

1. Copy `.env.example` to `.env.local` and leave values blank until the corresponding service is configured.
2. Run `npm install` and `npm run dev`.
3. Run `npm run typecheck`, `npm test`, and `npm run build` before submitting changes.

## Architecture direction

The present UI is a Vinext/Sites application. The planned production system keeps a separate Cloudflare Hono API boundary and uses Supabase over HTTP for authentication, PostgreSQL, and private storage. Financial values cross API boundaries as canonical decimal strings and will be stored as `NUMERIC(38,12)` in PostgreSQL. Economic dates are `YYYY-MM-DD`; system events will use UTC timestamps.

The module boundaries are identity/billing, accounts, ingestion, ledger, calculations, market data, and reporting. The source folders now establish the shared numeric, date, instrument-alias, configuration, and API-health contracts. The API is not mounted until user authentication and database ownership controls are implemented.

## Marketstack during development

Marketstack is not called by the application yet. When the daily-price job is implemented, use a development-only free key via `MARKETSTACK_API_KEY`; keep it server-only and use an explicit conservative request cap. Production configuration requires a commercial plan and rights review before any public release.
