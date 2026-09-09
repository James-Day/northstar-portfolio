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
| Sign-in | UI only | `/sign-in`; any nonempty password redirects; Google button also just redirects |
| User database / authentication | Not implemented | No Supabase client, migrations, session validation or ownership enforcement |
| CSV import | Prototype only | Browser file reader and basic parser; no durable storage or atomic commit |
| Financial calculations | Placeholder | Floating-point arithmetic, hard-coded realized basis deduction, no FIFO or Modified Dietz |
| Price database / historical seed | Not implemented | `demoHoldings` and `demoPrices` in `lib/portfolio.ts` supply displayed prices |
| Marketstack | Interface stub only | Provider throws for nonempty requests; no HTTP request or scheduled refresh |
| Billing / trial | Not implemented | No Stripe integration; trial label is hard-coded |
| Security / deletion / exports | Not implemented | No raw-file retention job, account deletion or export workflow |
| Automated tests / CI | Not implemented | No Vitest, Playwright, database tests or CI workflow |
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
- [ ] Establish a standalone Cloudflare Hono API and Queue/scheduler deployment configuration, with Supabase over HTTP. Verify the frontend host supports the required external auth redirect/session flow before wiring it; move the frontend to standalone Cloudflare hosting if needed to preserve independent email/Google login.
- [ ] Create module boundaries for identity/billing, accounts, ingestion, ledger, calculations, market data and reporting.
- [x] Add decimal arithmetic; use decimal strings at API boundaries and `NUMERIC(38,12)` in Postgres. Use numbers only for final chart/display conversion.
- [x] Add date-only economic dates, stable instrument IDs, effective-dated ticker aliases and typed validation contracts.
- [x] Add `.env.example`, secret handling, configuration checks and local setup documentation. Adjust the current `.env*` ignore rule so the example can be tracked safely.
- [x] Add typecheck, Vitest and Playwright scripts plus CI. Review dependency audit findings without blind major-version upgrades.
- [ ] Add database integration tests and real browser flows when the persistent backend and authenticated routes exist.

Acceptance: a fresh checkout can run documented checks; missing secrets fail clearly; no provider/service secrets enter the browser bundle.

### 03 — Create persistent databases and private storage

- [ ] Provision development Supabase and prepare separate production configuration.
- [x] Draft the initial migration for profiles, brokerage/IRA accounts, imports, immutable source rows, normalized ledger entries, lots/opening balances, instruments/aliases, price revisions, corporate actions/corrections, report snapshots, billing state, audit events and job outbox.
- [ ] Apply and verify the migration in Supabase; enable row-level security and ownership constraints on every user-owned table. Global prices are shared data with restricted writes.
- [x] Define a private brokerage-statement bucket and ownership policies in the initial migration.
- [ ] Verify signed upload access and account ownership validation against real storage.
- [ ] Add transactional operations for import commit/undo and versioned report publication.

Acceptance: data survives reload and a second session; user A cannot read or modify user B's accounts, imports or objects, even with guessed IDs.

### 04 — Implement real authentication

- [ ] Implement Supabase email/password signup, email verification, sign-in and sign-out.
- [ ] Configure Google OAuth, callbacks and permitted redirect URLs.
- [ ] Implement password reset, session renewal and expired/revoked-session handling.
- [ ] Protect application pages and API endpoints on the server; keep the public demo separate.
- [ ] Replace James/JC placeholders with authenticated profile data.

Acceptance: valid users can sign in and return later; invalid credentials fail; unauthenticated and revoked sessions cannot access private data. Supabase manages password hashes; never store plaintext passwords in app tables.

### 05 — Implement accounts and opening history

- [ ] Create, name and select Robinhood individual brokerage, traditional IRA and Roth IRA accounts.
- [ ] Associate every import with a confirmed account; do not claim account detection from a CSV that lacks that information.
- [ ] Add opening cash, positions and lots with known/unknown basis and dates.
- [ ] Record activity coverage separately from valuation freshness.

Acceptance: multiple accounts remain separate, fractional positions are supported, and unknown basis remains explicitly unknown.

### 06 — Replace the CSV parser with a validated importer

- [ ] Obtain redacted official brokerage and IRA CSV fixtures; add sanitized fixtures with expected results.
- [x] Use a real CSV parser supporting quoted commas, escaped quotes, embedded newlines and BOMs.
- [x] Validate dates, signed amounts, parentheses, decimals, required headers and row counts; enforce 10 MB / 50,000 rows in the server-side parser.
- [ ] Map verified Robinhood transaction codes rather than guessing from descriptions or using Process Date as the transaction type.
- [ ] Normalize buys/sells, dividends, reinvestment buys, interest, fees, deposits/withdrawals, incentives and supported transfers.
- [x] Preserve raw rows and parsing errors in the parser result; unsupported rows remain visible instead of disappearing.
- [ ] Persist file hash, parser version and review/commit blocking state with imports when the database workflow is connected.

Acceptance: supported fixtures reconcile row-for-row; malformed values never silently become zero; unsupported assets/codes remain visible.

### 07 — Build durable review, commit, deduplication and undo

- [ ] Queue parsing and persist staged results with progress/failure status.
- [ ] Show source rows, interpreted transactions, account/date range, duplicates and actionable warnings.
- [ ] Implement identical-file idempotency and multiplicity-aware overlap fingerprints including account, date, type, symbol, quantity, price, amount and description.
- [ ] Commit accepted records atomically with concurrency protection and an outbox event for recomputation.
- [ ] Add discard, import history and undo that preserves audit history and recomputes downstream state.

Acceptance: repeated and overlapping files never double-count; legitimate identical trades remain distinct; interrupted/retried commits are safe; undo restores the prior report state.

### 08 — Implement the accounting engine

- [x] Add a pure decimal ledger core that derives cash and open lots from normalized events.
- [x] Implement FIFO lots and analytical realized gains/losses; label them as not tax reporting.
- [x] Apply net trade amounts/fees once and preserve unknown basis through sales.
- [x] Record dividend income and a separate reinvestment purchase without double counting.
- [ ] Link internal transfers for consolidated reporting; preserve share lots/basis where supported and flag unresolved transfers.
- [ ] Validate corporate actions before applying quantity/basis changes; never automatically apply DoltHub split rows.

Acceptance: hand-calculated fixtures cover partial lot sales, fractional shares, fees, DRIP, transfers, incentives and splits; no hard-coded basis deductions remain.

### 09 — Populate the historical-price database

- [ ] Implement bounded/resumable DoltHub close-price ingestion with stable instrument mapping and source revision/ingestion metadata.
- [ ] Store unadjusted daily closes; keep dividend income sourced from brokerage activity.
- [ ] Validate selected stocks, ETFs, ticker changes, delisted securities and split boundaries against independent records.
- [ ] Detect invalid closes, missing trading dates, large jumps and alias discontinuities; quarantine suspicious data without altering holdings.
- [ ] Add evidence-backed corrections and immutable price revisions; track report dependencies on revisions.
- [ ] Record dataset attribution/share-alike obligations and resolve upstream provenance and commercial usage questions before public launch. A few successful spot checks do not settle licensing or whole-dataset quality.

Acceptance: repeated seed jobs are idempotent; suspicious records are excluded from authoritative valuations; a stored close can be traced to its source and correction history.

### 10 — Connect daily Marketstack pricing

- [x] Implement the server-only provider HTTP adapter and normalized decimal-string responses.
- [x] Add a free-development request budget object; configure an actual key and confirm the allowance before scheduling.
- [ ] Schedule after-market-close updates using U.S. trading sessions, holidays and daylight saving time.
- [ ] Fetch each unique currently held symbol once across users; use shared database values for every dashboard view.
- [ ] Add retry/backoff, pagination where needed, idempotency, gap backfills and dead-letter visibility.
- [ ] Add request budgeting, a hard application cap, quota alerts, failure metrics and stale-price metrics.
- [ ] Before paid launch, activate the agreed commercial tier and verify cache/display rights; do not purchase or upgrade automatically.

Acceptance: two users holding the same symbol reuse one price fetch; weekends do not waste requests; failures show honest freshness; opening dashboards consumes no provider quota.

### 11 — Implement valuation and return history

- [ ] Value daily actual quantities plus cash using stored unadjusted closes and verified corporate actions.
- [ ] Compute gain as ending value minus beginning value minus external flows and excluded incentives.
- [ ] Implement estimated daily Modified Dietz: `(end - start - flow) / (start + 0.5 * flow)`, then chain valid daily returns. Disclose the intraday-flow approximation.
- [ ] Exclude external contributions/withdrawals and incentives from investment return; offset linked internal transfers in consolidated views.
- [ ] Mark missing-data/invalid-denominator intervals unavailable; never chain across a gap or annualize short periods.
- [ ] Publish versioned report snapshots atomically with activity and price coverage.

Acceptance: deposits alone create no profit, reinvestment does not double income, missing prices do not become zero, and historical snapshots reconcile to independent fixtures.

### 12 — Connect the approved screens to real reports

- [ ] Replace all demo-backed production values with authenticated database-backed API responses.
- [ ] Add account/consolidated selection, value/return charts, allocation, holdings, net deposits, gains, cash, dividend and realized-gain details.
- [ ] Implement loading, empty, incomplete-history, stale-price, failure and retry states.
- [ ] Wire import history, undo, account setup and settings actions.
- [ ] Use accessible dialog/table/navigation primitives; verify keyboard operation, focus, mobile layouts and 200% text enlargement.
- [ ] Ensure any retained WebMCP tools share the real state/actions and pass contract checks; do not claim untested tool support.

Acceptance: no synthetic values leak into a real account; each visible number can be reconciled to ledger and price records; every enabled action works.

### 13 — Implement trials and billing

- [ ] Create Stripe test products/prices for $5 monthly and $49 annual plans; configure production separately.
- [ ] Start a no-card 14-day trial exactly once after the first usable committed import, including under concurrent requests.
- [ ] Add Checkout, Billing Portal and signed, replay-safe webhook handling.
- [ ] Enforce entitlement on the server and handle expiration, failed payments, cancellation and plan changes.
- [ ] Preserve export/deletion access after cancellation; replace the hard-coded trial countdown.

Acceptance: test-mode full lifecycle passes, invalid signatures are rejected, and duplicate/reordered webhooks cannot corrupt access.

### 14 — Complete privacy, operations and recovery

- [ ] Purge raw upload objects after 30 days with retryable jobs and auditable deletion results.
- [ ] Add safe CSV/report export, account deletion and complete user-data deletion workflows, including subscription cleanup.
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
| 2026-09-09 | 03 — Persistence (schema foundation) | Initial Supabase migration and public-client factory added; `npm run typecheck`, `npm test` (2 passing), and `npm run build` passed | Migration and storage policies are unverified until a development Supabase project is configured |
| 2026-09-09 | 10 — Marketstack provider (partial) | Server-only EOD adapter and request-budget guard added; `npm run typecheck`, `npm test` (4 passing), and `npm run build` passed | No free key, price database, schedule, metrics, retry, or dashboard integration yet |
| 2026-09-09 | 08 — Accounting engine (partial) | Decimal FIFO core added with fractional-lot, fee, DRIP, and unknown-basis fixtures; `npm run typecheck`, `npm test` (7 passing), and `npm run build` passed | Engine is not yet driven from the database; internal transfers and validated corporate actions remain unimplemented |
| 2026-09-09 | 06 — CSV parser (partial) | Strict CSV parser added with quoted-field/BOM, exact-code, amount/date, and unsupported-row fixtures; `npm run typecheck`, `npm test` (10 passing), and `npm run build` passed | Official redacted brokerage and IRA CSV fixtures are still required to validate headers and transaction-code coverage |

For each future implementation task: select the next numbered milestone, complete its checks, run its acceptance scenarios, and update this file with the date, commit and test results. Leave any unverified subtask unchecked. Do not count an entire milestone complete because its screen exists.
