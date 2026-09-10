# Portfolio tracker implementation checklist

Last audited: September 9, 2026.

This is the source of truth for implementation progress. `[x]` means the specific deliverable exists; `[ ]` means it still requires implementation or verification. A visual screen does not count as its backend being complete. Complete work in the numbered order below. On completion, record the date, commit, and relevant verification in the completion log.

## Current state

The application is a privately deployed visual prototype. It is not ready for real financial reporting or paying customers. Earlier descriptions of a completed MVP overstated the implementation.

| Original plan area | Actual status | Evidence / limitation |
| --- | --- | --- |
| React, TypeScript, Tailwind, components | Foundation exists | Uses Vinext on Vite and the Sites Worker scaffold; not the planned standalone React/Hono architecture |
| Landing page and pricing | Visual implementation exists | `/`; $5/month and $49/year copy; no checkout |
| Dashboard | Visual implementation exists | `/dashboard`; static holdings, chart, user identity, trial and freshness labels |
| Sign-in | UI only | `/sign-in`; real Supabase flows remain unconnected to the screen |
| User database / authentication | Local development implementation verified | Local Supabase schema, email/password users, Worker bearer-session verification, and RLS-backed account/import APIs were exercised; no hosted project or protected app pages yet |
| CSV import | Durable review staging implemented locally | Immutable review imports/source rows stage atomically in local Supabase; no file-object upload, commit, or dashboard reporting yet |
| Financial calculations | Placeholder | Floating-point arithmetic, hard-coded realized basis deduction, no FIFO or Modified Dietz |
| Price database / historical seed | Not implemented | `demoHoldings` and `demoPrices` in `lib/portfolio.ts` supply displayed prices |
| Marketstack | Development provider foundation | Server-only EOD adapter and free-plan budget guard exist; no configured key, database persistence, or scheduled refresh |
| Billing / trial | Not implemented | No Stripe integration; trial label is hard-coded |
| Security / deletion / exports | Not implemented | No raw-file retention job, account deletion or export workflow |
| Automated tests / CI | Foundation exists | Vitest unit tests and CI configuration exist; database and browser-flow coverage remain pending |
| Hosting | Private prototype deployed | Last confirmed deployment: version 3, commit `49d0287388a7c438758c05fe3616aa62e44664d8`; not rechecked remotely in this audit |
| Branding | Partial local change | Compass mark exists and is used on local landing page; branding changes are uncommitted and not confirmed deployed; name remains Northstar |

### Completed deliverables, with narrow scope

- [x] Initialize repository, package lockfile, React/TypeScript/Vite-based scaffold and UI primitives.
- [x] Establish the navy/blue visual direction approved by the user.
- [x] Create landing, sign-in and dashboard routes.
- [x] Display synthetic holdings, activity, income and a portfolio chart.
- [x] Add working navigation between overview, accounts, activity and documents views.
- [x] Add browser CSV selection and a client-side 10 MB size check.
- [x] Add a preliminary parser and review dialog with warning counts.
- [x] Display planned $5/month and $49/year pricing.
- [x] Successfully build and privately deploy the prototype in the previous implementation turns.
- [x] Create a local SVG compass logo component. This only checks off asset creation.

## Ordered implementation backlog

### 01 — Make the prototype truthful and safe to evaluate

- [x] Clearly label all synthetic prices, charts, accounts and performance as demo data.
- [x] Disable fake password/Google success paths until authentication exists; provide an explicitly named demo link instead.
- [x] Remove unsupported claims that files are encrypted/stored/purged and that reports are current or complete.
- [x] Keep parsed uploads in staging state; closing review must not replace portfolio activity.
- [x] Prevent uploaded activity from being combined with demo holdings or hard-coded realized gains.
- [x] Replace inactive actions with clear unavailable states until implemented.

Acceptance: entering arbitrary credentials cannot appear to authenticate; canceling an import changes nothing; real CSV rows cannot produce synthetic financial reports.

### 02 — Establish the production backend and test foundation

- [x] Preserve the approved UI and document the existing Vinext/Sites deviation from the original stack.
- [ ] Establish a standalone Cloudflare Hono API and Queue/scheduler deployment configuration, with Supabase over HTTP. Hono, scheduler, and queue bindings now bundle cleanly; queue consumers, auth session validation, and host redirect verification remain.
- [x] Create module boundaries for identity/billing, accounts, ingestion, ledger, calculations, market data and reporting.
- [x] Add decimal arithmetic; use decimal strings at API boundaries and `NUMERIC(38,12)` in Postgres. Use numbers only for final chart/display conversion.
- [x] Add date-only economic dates, stable instrument IDs, effective-dated ticker aliases and typed validation contracts.
- [x] Add `.env.example`, secret handling, configuration checks and local setup documentation. Adjust the current `.env*` ignore rule so the example can be tracked safely.
- [x] Add typecheck, Vitest and Playwright scripts plus CI. Review dependency audit findings without blind major-version upgrades.
- [ ] Add database integration tests and real browser flows when the persistent backend and authenticated routes exist.

Acceptance: a fresh checkout can run documented checks; missing secrets fail clearly; no provider/service secrets enter the browser bundle.

### 03 — Create persistent databases and private storage

- [x] Initialize local Supabase CLI configuration with development auth, redirects, 10 MB upload limit, and email-verification defaults.
- [x] Provision and reset a runnable local Supabase database; production configuration remains separate and unconfigured.
- [x] Draft the initial migration for profiles, brokerage/IRA accounts, imports, immutable source rows, normalized ledger entries, lots/opening balances, instruments/aliases, price revisions, corporate actions/corrections, report snapshots, billing state, audit events and job outbox.
- [x] Apply and verify the migration locally; row-level security and ownership constraints cover every user-owned table. Global prices are shared data with restricted writes.
- [x] Define a private brokerage-statement bucket and ownership policies in the initial migration.
- [ ] Verify signed upload access and account ownership validation against real storage. A tested server-side signed-upload boundary now validates account ownership before requesting a URL; live storage verification remains.
- [x] Add transactional operations for import commit/undo and versioned report publication.

Acceptance: data survives reload and a second session; user A cannot read or modify user B's accounts, imports or objects, even with guessed IDs.

### 04 — Implement real authentication

- [x] Implement a tested Supabase email/password signup, sign-in, sign-out, and provider-error boundary.
- [x] Implement a tested Google OAuth initiation boundary with configured callbacks.
- [x] Implement a tested password-reset initiation boundary and expired-session error handling.
- [x] Wire the sign-in screen and `/auth/callback` route to the Supabase client when public configuration is present; keep credential controls unavailable otherwise.
- [ ] Configure Supabase email verification, Google OAuth redirect URLs, session renewal, and revoked-session behavior in a live project.
- [x] Add Worker API bearer-session verification and a protected identity endpoint (`GET /v1/me`).
- [ ] Protect application pages and remaining API endpoints on the server; keep the public demo separate.
- [ ] Replace James/JC placeholders with authenticated profile data.

Acceptance: valid users can sign in and return later; invalid credentials fail; unauthenticated and revoked sessions cannot access private data. Supabase manages password hashes; never store plaintext passwords in app tables.

### 05 — Implement accounts and opening history

- [x] Add tested authenticated API contracts to list and create Robinhood individual brokerage, traditional IRA, and Roth IRA accounts through Supabase RLS.
- [ ] Create, name and select Robinhood individual brokerage, traditional IRA and Roth IRA accounts.
- [ ] Associate every import with a confirmed account; do not claim account detection from a CSV that lacks that information.
- [x] Add opening-history contracts for cash, positions and lots with known/unknown basis and dates.
- [x] Record activity coverage separately from valuation freshness.

Acceptance: multiple accounts remain separate, fractional positions are supported, and unknown basis remains explicitly unknown.

### 06 — Replace the CSV parser with a validated importer

- [ ] Obtain redacted official brokerage and IRA CSV fixtures; add sanitized fixtures with expected results.
- [x] Use a real CSV parser supporting quoted commas, escaped quotes, embedded newlines and BOMs.
- [x] Ignore the blank/footer records appended by official Robinhood activity exports without dropping transaction rows.
- [x] Validate dates, signed amounts, parentheses, decimals, required headers and row counts; enforce 10 MB / 50,000 rows in the server-side parser.
- [x] Map verified Robinhood transaction codes rather than guessing from descriptions or using Process Date as the transaction type.
- [x] Normalize buys/sells, dividends, reinvestment buys, interest, fees, deposits/withdrawals, incentives and supported transfers.
- [x] Preserve raw rows and parsing errors in the parser result; unsupported rows remain visible instead of disappearing.
- [x] Default unfamiliar transaction codes to material during import review, so a reportable import cannot commit until their impact is resolved.
- [x] Add a server-side preview contract that requires a confirmed owned account, records the original CSV SHA-256 and parser version, derives review/date-range metadata, and checks persisted identical-file hashes.
- [x] Persist the file hash, parser version, source rows, and review metadata with local staged imports. Commit-blocking state still requires the durable commit workflow.

Acceptance: supported fixtures reconcile row-for-row; malformed values never silently become zero; unsupported assets/codes remain visible.

### 07 — Build durable review, commit, deduplication and undo

- [x] Define and test durable import lifecycle transitions for staging, review, commit, discard, failure retry, and undo.
- [x] Add and locally verify an RLS-scoped atomic staging RPC and authenticated API route that persist an import plus immutable source rows together.
- [x] Add authenticated API contracts to list staged import history, retrieve preserved review rows, and discard a review-ready import without deleting audit history.
- [ ] Queue parsing and persist staged results with progress/failure status.
- [ ] Show source rows, interpreted transactions, account/date range, duplicates and actionable warnings.
- [x] Display preserved source-row statuses, interpreted activity, and parser messages in the authenticated review dialog.
- [x] Implement multiplicity-aware overlap fingerprints including account, date, type, symbol, quantity, price, amount and description.
- [x] Connect fingerprints to persisted file hashes and committed imports for identical-file idempotency.
- [x] Commit accepted records atomically with concurrency protection and an outbox event for recomputation.
- [x] Add discard, import history and undo that preserves audit history and recomputes downstream state.
- [x] Show account-scoped import history and expose undo only for the latest committed import, matching the database constraint.

Acceptance: repeated and overlapping files never double-count; legitimate identical trades remain distinct; interrupted/retried commits are safe; undo restores the prior report state.

### 08 — Implement the accounting engine

- [x] Normalize reviewed Robinhood rows into ledger-entry drafts; model DRIP as dividend income plus a separate reinvestment buy, preserve signed cash flows, and require a resolved stable instrument ID.
- [x] Add a pure decimal ledger core that derives cash and open lots from normalized events.
- [x] Implement FIFO lots and analytical realized gains/losses; label them as not tax reporting.
- [x] Apply net trade amounts/fees once and preserve unknown basis through sales.
- [x] Record dividend income and a separate reinvestment purchase without double counting.
- [x] Link reconciled internal transfers for consolidated reporting and flag unresolved transfers.
- [x] Preserve transferred share lots and basis through persisted cross-account transfers.
- [x] Enforce validated corporate actions before applying quantity/basis changes; never automatically apply quarantined split rows.

Acceptance: hand-calculated fixtures cover partial lot sales, fractional shares, fees, DRIP, transfers, incentives and splits; no hard-coded basis deductions remain.

### 09 — Populate the historical-price database

- [x] Implement a bounded/resumable DoltHub close-price source reader that observes a stable source revision for each page.
- [x] Connect DoltHub pages to stable instrument mapping and persisted ingestion metadata.
- [x] Store unadjusted daily closes; keep dividend income sourced from brokerage activity.
- [ ] Validate selected stocks, ETFs, ticker changes, delisted securities and split boundaries against independent records.
- [x] Detect invalid closes, duplicate dates, and large jumps; quarantine suspicious records without altering holdings.
- [x] Add trading-calendar missing-date and ticker-alias discontinuity checks during database ingestion.
- [ ] Add evidence-backed corrections and immutable price revisions; track report dependencies on revisions. A pure correction resolver now requires evidence/version and preserves the source close; persistence and report orchestration remain.
- [ ] Record dataset attribution/share-alike obligations and resolve upstream provenance and commercial usage questions before public launch. A few successful spot checks do not settle licensing or whole-dataset quality.

Acceptance: repeated seed jobs are idempotent; suspicious records are excluded from authoritative valuations; a stored close can be traced to its source and correction history.

### 10 — Connect daily Marketstack pricing

- [x] Implement the server-only provider HTTP adapter and normalized decimal-string responses.
- [x] Add a free-development request budget object; configure an actual key and confirm the allowance before scheduling.
- [x] Add a tested New York-time standard NYSE full-day holiday calendar and EOD eligibility guard; extraordinary closures and early closes remain explicit operational overrides.
- [x] Add a tested EOD refresh coordinator that coalesces supplied symbols and rejects incomplete, duplicate, off-date, or unrequested provider results before persistence.
- [ ] Schedule after-market-close updates using U.S. trading sessions, holidays and daylight saving time.
- [ ] Fetch each unique currently held symbol once across users; use shared database values for every dashboard view.
- [ ] Add retry/backoff, pagination where needed, idempotency, gap backfills and dead-letter visibility.
- [ ] Add request budgeting, a hard application cap, quota alerts, failure metrics and stale-price metrics. A durable monthly usage reader and preflight cap guard now prevent over-cap provider calls; alert delivery and full stale-price metrics remain.
- [ ] Before paid launch, activate the agreed commercial tier and verify cache/display rights; do not purchase or upgrade automatically.

Acceptance: two users holding the same symbol reuse one price fetch; weekends do not waste requests; failures show honest freshness; opening dashboards consumes no provider quota.

### 11 — Implement valuation and return history

- [x] Value daily actual quantities plus cash using stored unadjusted closes and verified corporate actions.
- [x] Compute gain as ending value minus beginning value minus external flows and excluded incentives.
- [x] Implement estimated daily Modified Dietz: `(end - start - flow) / (start + 0.5 * flow)`, then chain valid daily returns. Disclose the intraday-flow approximation.
- [ ] Exclude external contributions/withdrawals and incentives from investment return; offset linked internal transfers in consolidated views.
- [x] Mark missing-data/invalid-denominator intervals unavailable; never chain across a gap or annualize short periods.
- [ ] Publish versioned report snapshots atomically with activity and price coverage.

Acceptance: deposits alone create no profit, reinvestment does not double income, missing prices do not become zero, and historical snapshots reconcile to independent fixtures.

### 12 — Connect the approved screens to real reports

- [ ] Replace all demo-backed production values with authenticated database-backed API responses.
- [ ] Add account/consolidated selection, value/return charts, allocation, holdings, net deposits, gains, cash, dividend and realized-gain details. Persisted snapshots now carry and render dividend income and realized gain/loss when supplied by the ledger; charts, allocation, and full detail views remain.
- [ ] Implement loading, empty, incomplete-history, stale-price, failure and retry states.
- [ ] Wire import history, undo, account setup and settings actions.
- [ ] Use accessible dialog/table/navigation primitives; verify keyboard operation, focus, mobile layouts and 200% text enlargement.
- [ ] Ensure any retained WebMCP tools share the real state/actions and pass contract checks; do not claim untested tool support.

Acceptance: no synthetic values leak into a real account; each visible number can be reconciled to ledger and price records; every enabled action works.

### 13 — Implement trials and billing

- [ ] Create Stripe test products/prices for $5 monthly and $49 annual plans; configure production separately.
- [x] Implement the one-time no-card 14-day trial rule after a usable committed import.
- [x] Implement replay-safe entitlement webhook state handling; signature verification and Stripe HTTP endpoints remain pending.
- [ ] Add Checkout, Billing Portal and signed webhook HTTP handling.
- [ ] Enforce entitlement on the server and handle expiration, failed payments, cancellation and plan changes.
- [ ] Preserve export/deletion access after cancellation; replace the hard-coded trial countdown.

Acceptance: test-mode full lifecycle passes, invalid signatures are rejected, and duplicate/reordered webhooks cannot corrupt access.

### 14 — Complete privacy, operations and recovery

- [x] Implement and test 30-day raw-file eligibility and auditable one-time deletion state.
- [ ] Run the retention job against private storage with retries and verify deletions in a configured environment.
- [x] Add a tested account/user-deletion lifecycle and cleanup plan covering raw files, accounts, profile, and subscription cleanup.
- [ ] Execute deletion against live storage, billing, and database records; add safe CSV/report export.
- [ ] Apply rate limits, upload validation, safe logging, secret management and least-privilege access.
- [ ] Add queue, import, report and pricing monitoring with actionable alerts.
- [ ] Configure backups; execute and document a restore drill with chosen recovery objectives.
- [ ] Publish accurate privacy/terms content matching actual behavior and data-source requirements.

Acceptance: deletion and retention are verified against real storage; exports remain available after cancellation; restoration is demonstrated rather than merely configured.

### 15 — Finish branding and launch verification

- [ ] Choose the final product name and check domain/name conflicts before adopting it.
- [ ] Apply the selected logo consistently to landing, sign-in, dashboard and favicon; verify and publish the local branding changes.
- [ ] Run unit, integration, RLS/storage isolation and end-to-end suites in CI.
- [ ] Verify signup → account creation → upload → review → commit → accurate dashboard → trial → billing with representative brokerage and IRA files.
- [ ] Verify cross-user isolation, expired sessions, import concurrency, undo, missing prices and webhook replay.
- [ ] Confirm production auth, database, queue, retention, price provider, commercial data rights and billing configuration.
- [ ] Verify operating costs against the $45–75/month target and review any estimate above $100, excluding marketing.
- [ ] Launch to the intended audience only after the gates above pass and record deployed version/verification evidence.

Acceptance: launch gates are all checked with evidence. A successful frontend build alone does not meet this gate.

## External inputs needed

- [ ] Redacted real Robinhood brokerage, traditional IRA and Roth IRA activity exports.
- [ ] Supabase project configuration and authorized deployment access.
- [ ] Google OAuth configuration for the final application origin.
- [ ] Marketstack development key, followed by agreed commercial production configuration.
- [ ] Stripe test/live account configuration and webhook secrets.
- [ ] Final brand/domain choice and production data-licensing resolution.

Never put secrets in this checklist, commit them, or ask for them in ordinary chat when a secret configuration interface is available. Missing service access can block live verification while local implementation and fixture tests continue.

## Scope retained from the plan

MVP: U.S. investors, USD, long stocks/ETFs including fractional shares, cash, Robinhood activity CSVs, brokerage and traditional/Roth IRAs. $5/month or $49/year; no permanent free tier, with a clearly synthetic public demo.

Deferred: Plaid, PDFs/OCR, other brokerages, 401(k) imports, crypto/options/futures, margin/shorts, foreign exchange, tax/wash-sale reporting, benchmarks, money-weighted returns, advice/forecasting, households, banking and budgeting. Preserve provider/import adapters for expansion without implementing these now.

## Completion log

| Date | Checklist ID / deliverable | Evidence | Remaining limitation |
| --- | --- | --- | --- |
| 2026-09-09 | Repository audit and checklist created | Read routes, UI components, portfolio logic, package/config and Git status | No live services or runtime tests verified in this audit |
| 2026-09-09 | 01 — Truthful and safe prototype | Commit `9890b19`; synthetic labels, temporary CSV preview, disabled fake sign-in, and accurate unavailable states; `npm run build`, `npx tsc --noEmit`, and local `/dashboard` HTTP 200 passed | Full lint remains blocked by pre-existing vendored UI lint errors; no authentication, storage, reporting, or price data exists |
| 2026-09-09 | 02 — Backend/test foundation (partial) | Commit `9890b19`; exact-decimal/date/instrument contracts, server-only environment template, Hono API shell, Vitest/Playwright scripts, CI, README, dependency updates; `npm run typecheck`, `npm test` (2 passing), and `npm run build` passed | API shell is not mounted; Supabase, queues, database tests, and browser flows require service configuration and implementation |
| 2026-09-09 | 03 — Persistence (schema foundation) | Commit `2c5712c`; initial Supabase migration and public-client factory added; `npm run typecheck`, `npm test` (2 passing), and `npm run build` passed | Migration and storage policies are unverified until a development Supabase project is configured |
| 2026-09-09 | 10 — Marketstack provider (partial) | Commit `0bd1f98`; server-only EOD adapter and request-budget guard added; `npm run typecheck`, `npm test` (4 passing), and `npm run build` passed | No free key, price database, schedule, metrics, retry, or dashboard integration yet |
| 2026-09-09 | 08 — Accounting engine (partial) | Commit `956f410`; decimal FIFO core added with fractional-lot, fee, DRIP, and unknown-basis fixtures; `npm run typecheck`, `npm test` (7 passing), and `npm run build` passed | Engine is not yet driven from the database; internal transfers and validated corporate actions remain unimplemented |
| 2026-09-09 | 06 — CSV parser (partial) | Commit `672a6f3`; strict CSV parser added with quoted-field/BOM, exact-code, amount/date, and unsupported-row fixtures; `npm run typecheck`, `npm test` (10 passing), and `npm run build` passed | Official redacted brokerage and IRA CSV fixtures are still required to validate headers and transaction-code coverage |
| 2026-09-09 | 11 — Returns core (partial) | Commit `9e39fa3`; decimal Modified Dietz and non-bridging chain logic added with contribution, incentive, gap, and invalid-denominator fixtures; `npm run typecheck`, `npm test` (14 passing), and `npm run build` passed | No database-backed daily valuations, U.S. trading calendar, report snapshots, or dashboard integration yet |
| 2026-09-09 | 05 — Accounts/opening history (partial) | Commit `24d6f07`; supported account-type and incomplete-opening-history validation added; `npm run typecheck`, `npm test` (17 passing), and `npm run build` passed | Account creation, selection, and persistence require Supabase configuration and authenticated UI work |
| 2026-09-09 | 09 — Price quality (partial) | Commit `8257aa9`; candidate-close quarantine guard added with duplicate, invalid-close, extreme-move, and normal-history fixtures; `npm run typecheck`, `npm test` (19 passing), and `npm run build` passed | DoltHub ingestion, independent validation, aliases, corrections, and licensing resolution remain unimplemented |
| 2026-09-09 | 07 — Import deduplication (partial) | Commit `1d8e14d`; multiplicity-aware activity fingerprinting and overlap exclusion added; `npm run typecheck`, `npm test` (22 passing), and `npm run build` passed | Queue-backed staging, atomic commit/undo, persisted idempotency, and import history require the Supabase backend |
| 2026-09-09 | 07 — Atomic import commit (partial) | Commit pending; RLS-scoped `commit_import` migration locks review-ready imports, persists ledger entries/lots, treats DRIP as income plus reinvestment, marks imports committed, and writes a report-recompute outbox event. Endpoint/repository tests plus `npm run typecheck`, `npm test` (93 passing), `npm run build`, Worker dry-run, and local schema lint passed. | Persisted overlap-fingerprint enforcement, FIFO lot consumption on sales, background recomputation, undo, and UI review/commit remain. |
| 2026-09-09 | 06/07 — Real-export parser coverage and durable overlap exclusion (partial) | A user-provided 589-row Robinhood activity CSV established exact mappings for `CDIV`, `MDIV`, `AFEE`, `SLIP`, and `ACH` descriptions; blank records are ignored and split rows remain explicit blockers. Local Supabase integration committed an overlapping two-row import as one new activity with `duplicate,supported` source statuses. | Validated split handling, sanitized shareable fixtures, UI review, and report recomputation remain. |
| 2026-09-09 | 07 — Auditable latest-import undo (partial) | `undo_import` keeps source/ledger records, removes derived lots for the latest committed import, changes its status to `undone`, and emits an outbox event. Local Supabase integration verified `undone`, one retained ledger entry, and zero remaining derived lots. | Report recomputation worker and user-facing undo controls remain. |
| 2026-09-09 | 11 — Daily valuation core (partial) | Exact-decimal valuation derives cash and quantities from the normalized ledger, values only against supplied closes, calculates daily Modified Dietz and time-weighted return, and makes missing/gapped intervals unavailable. Fixtures cover deposits, incentives, DRIP, and missing prices. | Database report inputs, corporate actions, internal transfers, snapshots, and dashboard reads remain. |
| 2026-09-09 | 04/05 — Local authenticated account setup (partial) | Local Supabase configuration enables the existing sign-in flow; dashboard account setup lists and creates RLS-scoped Robinhood individual, Traditional IRA, and Roth IRA accounts without showing synthetic values as real balances. | Live deployment configuration, account selection, imports, and reports remain. |
| 2026-09-09 | 07/12 — Authenticated staged-import entry point (partial) | Signed-in users select a real account and send CSVs to the Worker for server-side preview and staging. Development CORS admits only the local app origin and expected import headers; the UI distinguishes staged review from portfolio commitment. | Source-row review, background processing, commit/undo controls, production origin configuration, and reports remain. |
| 2026-09-09 | 06/07/12 — Robinhood export review and history controls (partial) | Official-export footer handling, persisted source-row review, commit control, account-scoped history, and latest-only undo controls added. | Supported split handling, discard control, background report recomputation, and report display remain. |
| 2026-09-09 | 07/12 — Staged-import discard control | The review dialog now calls the authenticated discard endpoint when a staged import is closed or discarded, refreshes account-scoped history, prevents dismissal during a request, and clears committed review state safely. `npm run typecheck`, `npm test` (107 passing), `npm run build`, and `git diff --check` passed. | Background report recomputation and real report display remain. |
| 2026-09-09 | 06 — Supplied-export regression fixture (partial) | Added a sanitized Robinhood activity fixture covering embedded descriptions, `CDIV`, `Buy`, `ACH`, `SPL`, blank rows, and strict split blocking. Hardened footer handling for undefined mapped columns. `npm run typecheck`, `npm test` (108 passing), and `git diff --check` passed. | Redacted individual, traditional IRA, and Roth IRA fixtures with row-level expected reconciliations are still required. |
| 2026-09-09 | 09 — Historical ingestion boundary (partial) | Added stable instrument alias resolution, source-revision propagation, quality quarantine, and deterministic retry deduplication for DoltHub close pages. `npm run typecheck`, `npm test` (110 passing), and `git diff --check` passed. | Supabase price-revision/daily-price upserts, trading-calendar gaps, corrections, independent validation, and licensing review remain. |
| 2026-09-09 | 09 — Historical price persistence boundary (partial) | Added a server-only Supabase writer that reuses immutable DoltHub revisions and idempotently upserts stable-instrument daily closes; empty pages avoid unnecessary writes. `npm run typecheck`, `npm test` (112 passing), and `git diff --check` passed. | Live service wiring, scheduled ingestion, gap/correction workflows, independent validation, and licensing review remain. |
| 2026-09-09 | 10 — Daily refresh job runner (partial) | Added a dependency-injected runner that applies the New York EOD/session guard, coalesces symbols, validates complete provider results, and persists one shared batch. `npm run typecheck`, `npm test` (114 passing), and `git diff --check` passed. | Cloudflare cron wiring, active-symbol discovery, retries/backoff, quota metrics, and production persistence remain. |
| 2026-09-09 | 10 — Active-symbol discovery (partial) | Added a server-only Supabase reader that finds positive open lots across users, resolves current effective ticker aliases, and returns one sorted unique symbol set; empty portfolios short-circuit safely. `npm run typecheck`, `npm test` (116 passing), and `git diff --check` passed. | Scheduled Worker invocation, provider fetch/persistence wiring, retries/backoff, quota metrics, and stale-price reporting remain. |
| 2026-09-09 | 10 — Daily refresh retry safeguard (partial) | Added bounded exponential backoff with injectable delays around the guarded daily refresh; transient failures retry while the final error remains visible for job monitoring. `npm run typecheck`, `npm test` (117 passing), and `git diff --check` passed. | Cloudflare schedule, durable job state/dead-letter handling, quota alerts, and stale-price metrics remain. |
| 2026-09-09 | 10 — Daily refresh telemetry (partial) | Added structured events for refresh attempts, skips, transient/final failures, and persisted batches, including symbol counts and upsert totals. `npm run typecheck`, `npm test` (118 passing), and `git diff --check` passed. | Durable metrics sink, quota alerts, stale-price metrics, and Cloudflare schedule wiring remain. |
| 2026-09-09 | 10 — Refresh metrics and quota guard (partial) | Added an event collector for attempts, failures, skips, requested symbols, and persisted rows, plus a configurable quota evaluator with the planned 20% reserve alert. `npm run typecheck`, `npm test` (120 passing), and `git diff --check` passed. | Durable metrics storage, provider request reconciliation, stale-price metrics, alerts delivery, and Cloudflare schedule wiring remain. |
| 2026-09-09 | 10 — Durable market-data run metrics (partial) | Added the service-only `market_data_job_runs` table and REST repository for persisted status, retry/failure, symbol, row, quota, and error counters; local `supabase db lint` passed. `npm run typecheck`, `npm test` (121 passing), and `git diff --check` passed. | Worker orchestration, metrics aggregation sink integration, quota alerts delivery, and stale-price metrics remain. |
| 2026-09-09 | 10 — Refresh-to-metrics orchestration (partial) | Connected the retryable refresh runner and telemetry collector to a durable run-recorder interface; persisted, skipped, and terminal-failure outcomes each produce one operational record with quota and retry counters. `npm run typecheck`, `npm test` (122 passing), and `git diff --check` passed. | Cloudflare scheduled invocation, live active-symbol/provider/persistence composition, quota alert delivery, and stale-price metrics remain. |
| 2026-09-09 | 10 — Scheduler composition boundary (partial) | Added a scheduler-ready composition function that loads active symbols and invokes the complete guarded/retryable refresh with persistence and durable run recording. `npm run typecheck`, `npm test` (123 passing), and `git diff --check` passed. | Cloudflare `scheduled` hook, deployment bindings/secrets, live Marketstack writer, quota alert delivery, and stale-price metrics remain. |
| 2026-09-09 | 10 — Cloudflare scheduled adapter (partial) | Added a `waitUntil`-based Cloudflare scheduled-event adapter and included Worker tests in Vitest; the adapter passes scheduler timestamps into the full refresh composition. `npm run typecheck`, `npm test` (124 passing), Worker dry-run, and `git diff --check` passed. | Production Worker export/factory wiring, deployment bindings/secrets, live Marketstack writer, quota alerts, and stale-price metrics remain. |
| 2026-09-09 | 10 — Production refresh composition (partial) | Attached the Worker `scheduled` export to concrete Supabase active-symbol, Marketstack, daily-price, and durable-run repositories; required secrets and monthly cap are explicit bindings, and missing configuration fails closed. `npm run typecheck`, `npm test` (125 passing), Worker dry-run, and `git diff --check` passed. | Cloudflare cron declaration, deployed secrets, live provider/database execution, quota alert delivery, and stale-price metrics remain. |
| 2026-09-09 | 10 — Cron and deployment configuration (partial) | Declared an hourly weekday Cloudflare cron, retained the New York EOD eligibility guard for DST/holidays, added the local 100-request cap, and documented required Worker secrets and production rights review. `npm run typecheck`, `npm test` (125 passing), Worker dry-run, and `git diff --check` passed. | Deploying the Worker, configuring secrets, live provider/database execution, quota alert delivery, and stale-price metrics remain. |
| 2026-09-09 | 10/12 — Stale-price classification (partial) | Added a pure freshness evaluator that labels each active symbol current, stale, or missing against the expected valuation date, preserving explicit missing data for UI/report disclosure. `npm run typecheck`, `npm test` (126 passing), and `git diff --check` passed. | Database latest-close query, dashboard freshness display, and live scheduled execution remain. |
| 2026-09-09 | 10/12 — Latest-close storage reader (partial) | Added a service-only Supabase reader that returns the newest stored daily-price date per stable instrument and preserves null for missing history. `npm run typecheck`, `npm test` (127 passing), and `git diff --check` passed. | Symbol-to-ID report composition, dashboard freshness display, and live scheduled execution remain. |
| 2026-09-09 | 12 — Report freshness composition (partial) | Added a storage-independent report join that maps stable instrument IDs to symbols and emits dashboard-ready current, stale, or missing price states. `npm run typecheck`, `npm test` (128 passing), and `git diff --check` passed. | Authenticated report API, dashboard integration, and live scheduled execution remain. |
| 2026-09-09 | 12 — Authenticated freshness API (partial) | Added `GET /v1/accounts/:accountId/price-freshness`, requiring a verified bearer session and delegating account ownership/data access to an injected report repository; unavailable reporting storage returns an explicit 503. `npm run typecheck`, `npm test` (129 passing), and `git diff --check` passed. | Concrete Supabase report repository, dashboard integration, and live scheduled execution remain. |
| 2026-09-09 | 12 — Supabase freshness report repository (partial) | Added the concrete service-only repository that verifies account ownership, reads open lots, resolves effective aliases, queries latest stored closes, and composes current/stale/missing rows. `npm run typecheck`, `npm test` (131 passing), and `git diff --check` passed. | Worker/API factory wiring, dashboard integration, and live scheduled execution remain. |
| 2026-09-09 | 12 — Freshness API factory wiring (partial) | The API now constructs the concrete Supabase freshness repository from service bindings automatically, retaining injected repositories for tests and explicit 503 behavior when bindings are absent. `npm run typecheck`, `npm test` (131 passing), Worker dry-run, and `git diff --check` passed. | Dashboard client integration and live scheduled execution remain. |
| 2026-09-09 | 12 — Dashboard freshness integration (partial) | Signed-in users with a selected account now load the authenticated freshness report and see current/stale/missing counts, loading state, and explicit unavailable errors; synthetic demo users remain isolated from live report state. `npm run typecheck`, `npm test` (131 passing), `npm run build`, and `git diff --check` passed. | Full report values/charts, authenticated browser E2E, and live service configuration remain. |
| 2026-09-09 | 11/12 — Versioned report snapshot publisher (partial) | Added a service-only Supabase publisher for immutable account/consolidated/dashboard snapshots, carrying as-of date, import-state revision, price-revision dependency, and decimal payloads in one insert. `npm run typecheck`, `npm test` (132 passing), local `supabase db lint`, and `git diff --check` passed. | Snapshot generation from persisted ledger/price inputs and authenticated dashboard report reads remain. |
| 2026-09-09 | 11/12 — Snapshot payload generation (partial) | Added a report payload builder from exact valuation history, preserving activity/price coverage, latest holdings/cash/value, chained return, and unavailable valuation dates. `npm run typecheck`, `npm test` (133 passing), and `git diff --check` passed. | Persisted ledger/price loading, atomic publication orchestration, and authenticated dashboard report reads remain. |
| 2026-09-09 | 12 — Persisted report read API (partial) | Added a caller-token Supabase snapshot reader and authenticated `GET /v1/accounts/:accountId/report` with RLS-backed latest-snapshot lookup, explicit 503 configuration handling, and 404 empty state. `npm run typecheck`, `npm test` (135 passing), and `git diff --check` passed. | Snapshot generation orchestration, dashboard report integration, and live service configuration remain. |
| 2026-09-09 | 12 — Dashboard persisted snapshot values (partial) | Dashboard now loads the latest authenticated report snapshot and replaces demo hero value, cash, return, as-of date, and labeling when present; no-snapshot users retain the synthetic demo. `npm run typecheck`, `npm test` (135 passing), `npm run build`, and `git diff --check` passed. | Real holdings tables/charts, snapshot generation from persisted inputs, and browser E2E remain. |
| 2026-09-09 | 12 — Dashboard persisted holdings (partial) | Authenticated snapshots now replace the synthetic holdings table with stored instrument IDs, quantities, closes, values, and explicit unavailable states; demo users retain synthetic holdings. `npm run typecheck`, `npm test` (135 passing), `npm run build`, and `git diff --check` passed. | Display-name mapping, real charts/dividends/realized gains, and browser E2E remain. |
| 2026-09-09 | 12 — Instrument display labels (partial) | Added stable label resolution that prefers nonblank stored instrument names and falls back to internal IDs; persisted holdings render both when a friendly name is present. `npm run typecheck`, `npm test` (136 passing), and `git diff --check` passed. | Database display-name loading, real charts/dividends/realized gains, and browser E2E remain. |
| 2026-09-10 | 02 — Cloudflare queue deployment bindings (partial) | Declared separate import, report, and price Cloudflare Queues with bounded batch/retry settings and dead-letter queues in `wrangler.api.toml`; Wrangler dry-run confirmed all bindings. Documented that request handlers remain authoritative until consumers are implemented. | Queue producers/consumers, persistent processing status, and deployed queue resources remain. |
| 2026-09-10 | 02 — Typed portfolio module boundaries | Added the public `PortfolioModulePorts` composition contract and test for identity/billing, accounts, ingestion, ledger, calculations, market data, and reporting seams. Documented the dependency direction so adapters can evolve behind typed ports. `npm run typecheck`, `npm test`, and `git diff --check` passed. | Queue consumers, live service configuration, and database/browser integration remain. |
| 2026-09-10 | 03 — Private signed statement upload boundary (partial) | Added an account-ownership check and server-only Supabase Storage signed-upload repository for the private `brokerage-statements` bucket, with path-traversal/file-name validation and failure handling. Repository tests cover authorized, unauthorized, and invalid-name cases. | Live Supabase Storage execution, upload completion, retention job, and import linkage remain. |
| 2026-09-10 | 03/11 — Idempotent report publication | Added a generated publication key and unique index for report snapshots, then changed the service repository to use conflict-safe upserts so retried publication cannot duplicate the same account/date/import/price revision. Repository coverage verifies the conflict target and merge preference. | Migration still requires application to a configured project; report generation from persisted inputs remains. |
| 2026-09-10 | 05 — Account activity coverage | Added a transactional Supabase trigger that derives each account’s activity coverage from its committed imports and recomputes it after commit or undo, keeping it independent from valuation price freshness. Local schema lint passed. | Live project migration and UI display remain. |
| 2026-09-10 | 03/07 — Signed-upload API boundary (partial) | Added authenticated `POST /v1/accounts/:accountId/upload-url`, forwarding the verified user token through the account ownership check before issuing a private Storage URL. API coverage verifies the account-scoped request and response. | Browser upload completion, storage-object linkage, retention execution, and live-project verification remain. |
| 2026-09-10 | 06 — Complete supported activity normalization | Added regression coverage for Robinhood buys, sells, cash dividends, interest, fees, IRA contributions/distributions, and internal transfers, including signed cash-flow and external-flow semantics. | Persisted import processing and live fixtures remain. |
| 2026-09-10 | 09 — Resumable historical-page persistence | Added `ingestDoltHubHistory`, which walks bounded pages, preserves one source revision, resolves date-effective stable aliases, persists accepted unadjusted closes, and aggregates quarantined records. Revision changes fail closed. Coverage now checks both-page cursoring and revision mismatch handling. | Live DoltHub run, independent validation, corrections, and licensing review remain. |
| 2026-09-10 | 09 — Historical continuity safeguards | Added trading-calendar-aware missing-date detection and date-effective alias-gap detection to historical ingestion; issues are surfaced as metadata without inventing prices. Tests cover a missing trading day and an unresolved ticker. | Live dataset validation, corrections, and licensing review remain. |
| 2026-09-10 | 09 — Evidence-backed correction persistence (partial) | Added a service-only Supabase writer for evidence-backed corrections with an idempotent instrument/date/version conflict key; repository coverage verifies persisted evidence and retry-safe upserts. | Report dependency wiring and independent evidence review remain. |
| 2026-09-10 | 11/12 — Ledger report metrics in snapshots (partial) | Snapshot payloads now carry exact ledger net deposits, dividend income, and FIFO realized gain/loss, and authenticated dashboard cards render persisted dividend/realized values when present. | Snapshot generation still needs persisted-ledger orchestration; charts, allocation, and live detail views remain. |
| 2026-09-10 | 11/12 — Persisted valuation chart data (partial) | Snapshot payloads now include daily valuation points, preserving nulls for unavailable dates; the authenticated dashboard chart uses persisted history and never falls back to synthetic demo points for a live account. | Snapshot generation from persisted inputs, allocation, and live detail views remain. |
| 2026-09-10 | 11 — Corporate-action-aware valuation | Valuation now applies only validated, effective-dated splits and symbol changes to open lots before pricing, preserving basis and quarantining unvalidated actions through the existing guard. Fixtures verify split quantity/value behavior. | Persisted corporate-action loading, live report orchestration, and independent source validation remain. |
| 2026-09-10 | 10 — Durable monthly Marketstack cap guard (partial) | Added a service-only monthly quota reader over durable pricing-run metrics and a preflight guard that skips before provider calls when the application cap would be exceeded; worker scheduling now supplies the guard. Tests cover cap exhaustion. | Quota alert delivery, production persistence, and full stale-price metrics remain. |
| 2026-09-10 | 08 — Cross-account lot transfer basis | Added FIFO lot transfer application for reconciled inbound/outbound share transfers, preserving acquisition dates and proportional cost basis while leaving insufficient or mismatched transfers unresolved. Tests cover partial-lot transfers and rollback on insufficient shares. | Persisted transfer execution and consolidated report orchestration remain. |
| 2026-09-09 | 07 — Import workflow (partial) | Lifecycle and review-commit blocking rules added; `npm run typecheck`, `npm test` (25 passing), and `npm run build` passed | Lifecycle is not yet persisted or processed through queues |
| 2026-09-09 | 08 — Corporate-action safeguards (partial) | Validated split and ticker-change lot handling added; `npm run typecheck`, `npm test` (28 passing), and `npm run build` passed | Corporate actions are not yet sourced, evidenced, or connected to stored price history |
| 2026-09-09 | 08 — Internal-transfer linking (partial) | Reconciled-account transfer linking and unresolved-transfer rules added; `npm run typecheck`, `npm test` (30 passing), and `npm run build` passed | Transferred lots/basis require persisted cross-account transfer workflows |
| 2026-09-09 | 04 — Authentication boundary (partial) | Supabase email/password, Google OAuth, reset, sign-out, and error-path interfaces added; `npm run typecheck`, `npm test` (33 passing), and `npm run build` passed | Live provider configuration, session handling, protected routes, and profile UI require a configured Supabase project |
| 2026-09-09 | 13 — Billing entitlement rules (partial) | One-time trial and replay-safe event reducers added; `npm run typecheck`, `npm test` (36 passing), and `npm run build` passed | Stripe products, signed HTTP webhooks, checkout, billing portal, and server enforcement require Stripe configuration |
| 2026-09-09 | 14 — Raw-file retention (partial) | 30-day retention eligibility and auditable deletion-state rules added; `npm run typecheck`, `npm test` (38 passing), and `npm run build` passed | Storage deletion job, retries, and verification require private Supabase storage |
| 2026-09-09 | 14 — User-deletion rules (partial) | User-data deletion lifecycle and complete cleanup-plan rules added; `npm run typecheck`, `npm test` (40 passing), and `npm run build` passed | Actual storage, billing, database, and export execution requires configured services |
| 2026-09-09 | 03/04 — Local Supabase configuration (partial) | Supabase CLI configuration initialized with product-aligned local auth, redirects, file-size settings, and a local public-client configuration | Docker Desktop 4.90.0 has a Windows runtime-socket failure that prevents stable local database startup; no hosted Supabase project is linked |
| 2026-09-09 | 04 — Worker session verification (partial) | Commit `02c4f26`; `GET /v1/me` verifies Supabase bearer tokens server-side and returns only a validated user; `npm run typecheck`, `npm test` (48 passing), `npm run build`, and Worker dry-run passed | Hosted Supabase configuration, frontend route protection, and persistence authorization are still incomplete |
| 2026-09-09 | 02 — Standalone API Worker foundation (partial) | Hono Worker entrypoint, deployment config, binding-safe health route, and dry-run bundle added; `npm run typecheck` and `npm test` (41 passing) passed | Queues, schedules, authenticated API routes, and deployed configuration remain pending |
| 2026-09-09 | 02/03/04/07 — Local database and authenticated import staging | Docker Desktop 4.90.0 repaired; local Supabase reset applied all three migrations and `db lint` passed. A real local user created an account, previewed and staged a CSV, listed its staged import, and a second authenticated user was denied access. Worker compatibility date and Worker-safe `fetch` adapters were corrected. `npm run typecheck`, `npm test` (88 passing), `npm run build`, and Worker dry-run passed | No hosted Supabase project, private file-object upload, durable commit/undo, or protected app UI yet |

For each future implementation task: select the next numbered milestone, complete its checks, run its acceptance scenarios, and update this file with the date, commit and test results. Leave any unverified subtask unchecked. Do not count an entire milestone complete because its screen exists.
