# Portfolio tracker implementation checklist

Last audited: September 10, 2026. Source baseline: `60ba90a`.

## How to use this checklist

This file is the current implementation plan. Work through the numbered steps in order, taking the first unchecked task within each step. Check off only the exact deliverable described. Each step ends with a separate acceptance gate: working building blocks do not imply an integrated feature is complete.

- `[x]` = implementation exists and has supporting code/test evidence for the stated scope.
- `[ ]` = implementation, correction, integration, or verification remains.
- Checked tasks are deliberately narrow. Local verification does not prove hosted deployment.
- Stable IDs such as **04.03** are used in future work logs. Do not renumber existing IDs when adding tasks.
- Keep commits large and coherent. Record meaningful milestone evidence rather than a log entry for every small UI change.
- Never commit secrets. Configure credentials through local ignored environment files or the service's secret interface.

**Current count: 102 tasks — 33 checked, 69 unchecked, across 13 ordered steps.**

Counts describe task completion, not remaining engineering effort or launch readiness. The old checklist grouped several unfinished requirements under checked items; these counts are a new baseline, not a regression in delivered code.

## Audit conclusion

The project has a substantial local implementation: authentication wiring, account setup, durable import APIs/RPCs, decimal accounting functions, historical/daily price adapters, report storage/readers, and a dashboard that can render supplied snapshots. It is **not yet an end-to-end portfolio tracker**: committed activity is not automatically replayed into reconciled positions and reports. Billing and privacy execution remain largely unconnected.

The frontend uses React/TypeScript/Tailwind with **Vinext/Vite and Sites**. A separate **Hono Cloudflare Worker** exists; Supabase is the database/auth/storage boundary. Preserve this documented stack rather than restarting the approved UI.

| Area | Current evidence | Remaining boundary |
| --- | --- | --- |
| Public product | Landing, sign-in, synthetic demo, compass mark, pricing copy | Final branding, accessibility audit, deployment verification |
| Identity/accounts | Supabase client auth, verified API tokens, RLS account list/create, account selection UI | Protected private routes, recovery completion, live OAuth/session verification |
| Imports | Strict parser, sanitized sample, persisted review, commit/discard/latest-only undo APIs and controls | Concurrency/replay fixes, private file lifecycle, queue execution, full fixture acceptance |
| Accounting | Tested decimal FIFO, fees, income, transfers, corporate-action helpers | One authoritative chronological replay into persisted positions |
| Prices | DoltHub ingestion/writers; Marketstack cron composition, retry and metrics code | Verified seed, daily fetch deduplication, accurate durable quota accounting, live execution |
| Reports | Valuation/return functions, snapshot publisher/read API, snapshot-backed UI | Database input loader, outbox-to-report execution, consolidated/detail reports |
| Billing/privacy | Pure entitlement, trial, retention and deletion rules | Durable effects, Stripe HTTP integration, enforcement, export/deletion UI |
| Tests | Typecheck and 160 tests across 50 files passed in this audit | Real database, storage and authenticated browser regression suites |

No hosted services, price datasets, provider credentials, or commercial licensing were reverified in this documentation audit. Previous local Supabase integration evidence is retained in [the historical log](docs/IMPLEMENTATION_HISTORY.md); it is not a fresh live test.

## 01 — Establish a reproducible development and verification baseline

Owner: platform/integration. Start here; later steps rely on a repeatable local database and API.

- [x] **01.01** Repository, React/TypeScript/Tailwind UI, module boundaries, decimal-string/date/instrument contracts exist. Evidence: `package.json`, `services/module-boundaries.ts`, `lib/domain/`.
- [x] **01.02** Local Supabase configuration, migrations, private bucket/RLS definitions and setup documentation exist. Evidence: `supabase/`, `README.md`.
- [x] **01.03** Standalone Hono API Worker, cron/queue declarations, environment template and server-side provider configuration exist. Evidence: `workers/api.ts`, `wrangler.api.toml`, `.env.example`.
- [x] **01.04** CI runs typecheck, Vitest and build; Playwright scripts and three public-page tests exist. Evidence: `.github/workflows/checks.yml`, `tests/e2e/public-pages.spec.ts`. Browser tests are not yet in CI.
- [ ] **01.05** Add a repeatable local integration harness: reset/apply migrations, seed two isolated users plus instrument aliases, start API/frontend, and clean up test data. Read `docs/DOCKER_WINDOWS_RECOVERY.md` before Docker repairs.
- [ ] **01.06** Automate database constraints/RLS tests for every user-owned table, private objects and service-only global writes; test guessed IDs and direct database writes, not only mocked repositories.
- [ ] **01.07** Gate: run the documented workflow from a fresh checkout and record migration, database-isolation, typecheck, unit and build results. Confirm browser output excludes service/provider secrets.

## 02 — Finish identity and account access

Owner: identity/accounts. Depends on step 01.

- [x] **02.01** Email/password signup/sign-in/sign-out, Google initiation and password-reset initiation boundaries exist; sign-in and callback screens use configured Supabase. Evidence: `services/auth/`, `components/sign-in-page.tsx`, `components/auth-callback-page.tsx`.
- [x] **02.02** Existing private API endpoints verify bearer sessions; account/import queries use user RLS or explicit ownership checks. Evidence: `services/api/app.ts`, `services/auth/server-session.ts`.
- [x] **02.03** Authenticated account naming/creation for brokerage, traditional IRA and Roth IRA, listing, selection and load-error retry UI exist. Evidence: `components/portfolio-app.tsx`, `services/accounts/`.
- [x] **02.04** Signed-in shell uses session identity and an account-workspace label; public synthetic demo is labeled separately. Evidence: `components/portfolio-app.tsx`.
- [ ] **02.05** Separate private workspace routing from public demo; enforce server-side access where private pages are served and show an explicit session-loading state.
- [ ] **02.06** Complete recovery password submission and verify signup verification, session renewal, logout/revocation and account switching; clear private cached UI data on session changes.
- [ ] **02.07** Configure/verify Google and email redirects in the target environment, including final origin and invalid callback handling.
- [ ] **02.08** Gate: two real local users can create/select each supported account type; invalid/revoked sessions cannot read private account data in API or browser flows.

## 03 — Make imported activity trustworthy

Owner: ingestion. Depends on steps 01–02.

- [x] **03.01** CSV parsing supports quoting, multiline fields, BOMs, official footer/blank records, strict dates/decimals/headers and server parser limits of 10 MB/50,000 rows. Evidence: `services/ingestion/robinhood.ts` and tests.
- [x] **03.02** Supported activity mappings, raw-row/error preservation, SHA-256/parser metadata and unsupported-row blocking exist. Evidence: `services/ingestion/staging.ts`, `ledger-normalization.ts`.
- [x] **03.03** A sanitized regression sample derived from supplied-export cases exists. Evidence: `fixtures/robinhood/activity-sample.csv`; this is not full brokerage/IRA acceptance.
- [x] **03.04** User confirms an owned account for persisted imports; account-scoped preview/staging and review/history APIs exist. Evidence: `services/api/app.ts`, `services/supabase/imports-repository.ts`.
- [ ] **03.05** Add representative sanitized individual, traditional IRA and Roth IRA exports with independent row-level expected results. The user already supplied one brokerage example; obtain only missing coverage.
- [ ] **03.06** Reconcile actual dividend/reinvestment CSV semantics so separately reported dividends plus buys never create a second dividend; verify fees, transfers, incentives and fractional activity across parser, SQL and calculation paths.
- [ ] **03.07** Add durable issue resolution or explicit non-reportable handling for unsupported rows, missing aliases and incomplete history; never silently dismiss material blockers.
- [ ] **03.08** Gate: accepted fixtures reconcile every row, quantity and cash amount; malformed values and unsupported assets cannot produce an apparently complete account.

## 04 — Correct transactional commit, overlap detection and undo

Owner: ingestion/database. Depends on step 03. Finish before trusting persisted positions.

- [x] **04.01** Atomic staging, source-row retention, commit RPC, latest-import undo RPC and outbox inserts exist. Evidence: staging/commit/undo migrations and `services/supabase/imports-repository.ts`.
- [x] **04.02** Multiplicity-aware fingerprint helpers and SQL overlap checks exist; review/history/commit/discard/latest-only undo UI is connected. Evidence: `services/ingestion/deduplication.ts`, `components/portfolio-app.tsx`.
- [ ] **04.03** Serialize commits/undo at account level. Current commit locks one import, allowing two different overlapping imports to observe the same prior counts. Prove concurrent overlapping commits preserve intended multiplicity.
- [x] **04.04** Exclude undone imports from effective duplicate counts and define identical-file reimport/retry behavior. The replay migration filters active imports, clears fingerprints from undone derived rows, and repository tests cover status filtering.
- [ ] **04.05** Make repeated commit/undo requests return stable outcomes, including retries after an unknown network result; test same-file staging races and fingerprint canonicalization across TS/SQL.
- [ ] **04.06** Preserve original parsing evidence when deriving duplicate/review statuses; enforce permitted mutations and transition rules against direct client writes as well as API calls.
- [ ] **04.07** Gate: database tests cover repeated files/trades, overlapping exports, concurrent requests, undo/reimport and rollback on blockers. Undo restores effective activity while preserving audit records.

## 05 — Complete private uploads and background execution

Owner: platform/ingestion. Depends on step 04; queue consumers must use the corrected transaction rules.

- [x] **05.01** Private bucket policies and owned-account signed-upload API/repository exist. Evidence: initial migration, `services/supabase/signed-upload-repository.ts`.
- [x] **05.02** Typed import/report/price jobs and retry-aware dispatcher exist. Evidence: `services/queues/`. Worker has no `queue` export or durable handlers yet.
- [ ] **05.03** Upload the actual object, bind verified object metadata/hash to its import, enforce streamed request limits and validate ownership/size/content server-side before processing.
- [ ] **05.04** Wire Cloudflare queue entrypoint and durable import handler; persist processing/progress/failure state and let browser review poll durable results.
- [ ] **05.05** Dispatch the transactional outbox with claim/retry/idempotency semantics. Translate `import.committed`/`import.undone` events to typed recomputation jobs; verify account ownership at execution.
- [ ] **05.06** Persist rejected-job/error evidence before acknowledgment; implement dead-letter inspection and safe replay.
- [ ] **05.07** Gate: real storage isolation and queued import tests pass; retry/crash never loses an upload, commits twice or silently drops failed work.

## 06 — Reconcile persisted accounting and opening history

Owner: ledger/calculations. Depends on steps 04–05.

- [x] **06.01** Pure decimal FIFO/cash/fee/dividend/unknown-basis calculations exist with fixtures. Evidence: `services/ledger/fifo.ts` and tests.
- [x] **06.02** Opening cash/position/lot validation contracts exist. Evidence: `services/accounts/opening-history.ts`.
- [x] **06.03** Transfer matching/basis-preserving lot helpers and validated corporate-action guards exist. Evidence: `services/ledger/transfers.ts`, `corporate-actions.ts`. These do not prove persisted execution.
- [ ] **06.04** Persist/edit opening cash and known/unknown lots through owned APIs/UI; mark incomplete cost basis/return coverage without inventing dates or basis.
- [ ] **06.05** Build an authoritative loader/replay of only effective committed ledger events plus opening history; use deterministic same-day ordering and reconcile SQL normalization to engine contracts.
- [ ] **06.06** Rebuild/persist lot quantities and realized matches after buys, sales and undo. Current commit inserts purchase lots but does not consume lots on sales; active-symbol discovery therefore cannot yet be trusted.
- [ ] **06.07** Apply splits in chronological event order, before later trades. Current valuation applies actions after replaying all trades through a date, which can incorrectly split post-action purchases or process post-split sales against pre-split quantities. Test buy → split → buy/sell and repeated actions.
- [ ] **06.08** Persist and execute reconciled cross-account cash/share transfers, preserve basis/dates, and keep unresolved transfers explicit. Preserve stable instrument identity across ticker aliases.
- [ ] **06.09** Gate: database-derived cash, positions, FIFO gains, fees, DRIP, transfers and splits reconcile to independent fixtures before and after undo. Analytical gains are labeled “not tax reporting.”

## 07 — Establish trusted historical prices

Owner: market data. Depends on instrument identity in step 06; licensing research may proceed earlier.

- [x] **07.01** Bounded DoltHub reader/ingestion coordinator, revision checks and date-effective alias resolution exist. Evidence: `services/market-data/dolthub.ts`, `historical-ingestion.ts`.
- [x] **07.02** Unadjusted close/revision writers and evidence-bearing correction resolver/writer exist. Evidence: `services/supabase/historical-prices-repository.ts`, `services/market-data/price-corrections.ts`.
- [x] **07.03** Invalid/duplicate/extreme-close quarantine and missing-session/alias-gap checks exist. Evidence: `services/market-data/quality.ts`, historical-ingestion tests.
- [ ] **07.04** Record dataset version, actual license, attribution/share-alike requirements and upstream provenance evidence; resolve rights for intended paid storage/display before user-facing use. Do not treat spot checks as licensing clearance.
- [ ] **07.05** Add a runnable resumable seed job with durable cursor, instrument mapping, quarantine storage and operator review; execute a bounded seed and record rows/revision.
- [ ] **07.06** Independently verify representative stocks, ETFs, delisted names, ticker transitions and split boundaries; record expected/actual values and source evidence. Keep dividends sourced from brokerage activity.
- [ ] **07.07** Prevent same-version price/correction overwrite; select authoritative revisions deterministically and track all source/correction dependencies needed to reproduce a report.
- [ ] **07.08** Gate: repeat seed is safe, quarantined data cannot value portfolios, and representative stored prices are independently verified and traceable.

## 08 — Make daily pricing safe on the free development allowance

Owner: market data/platform. Depends on steps 06–07.

- [x] **08.01** Server-only Marketstack provider, decimal responses and configurable budget exist. Evidence: `services/market-data/marketstack.ts`.
- [x] **08.02** New York EOD/standard-holiday guard, unique-symbol reader, response validation, retry/backoff, storage writer and scheduled Worker composition exist. Evidence: `workers/api.ts`, `services/market-data/daily-refresh.ts`, `services/supabase/active-symbols-repository.ts`.
- [x] **08.03** Durable run metrics, monthly usage reader, preflight cap and freshness classifiers/read API/UI exist. These are foundations, not a proven hard quota guarantee.
- [x] **08.04** Skip already-fetched symbol/trading-date closes before calling the provider. Daily-price persistence exposes a missing-symbol lookup, the refresh coordinator returns an explicit `already_fetched` skip, and tests cover fully and partially cached batches. Durable concurrent claims remain part of 08.05.
- [ ] **08.05** Fix request accounting: skipped runs currently emit attempt symbol counts that become quota units; reserve budget atomically before actual calls, reconcile attempts/failures and prevent concurrent overspend.
- [ ] **08.06** Add paginated active-position/alias reads and provider-sized batches, explicit unresolved aliases, delayed-publication handling and gap backfills. Verify extraordinary calendar closures and session overrides.
- [ ] **08.07** Configure a free development key, confirm its current allowance, and run a deliberately tiny live fetch into the database. Keep automatic schedules off until 08.04–08.05 pass; no purchase/upgrade.
- [ ] **08.08** Deliver quota/failure/stale-price alerts and durable recovery visibility; test provider outage and partial responses without fabricating closes.
- [ ] **08.09** Gate: two users with one shared holding cause one symbol/date fetch; repeated/concurrent cron and dashboard loads add no redundant calls; free cap is enforced across retries.

## 09 — Generate reproducible reports automatically

Owner: reporting/calculations. Depends on steps 05–08.

- [x] **09.01** Daily valuation and Modified Dietz/chain functions exist, excluding contributions/incentives and exposing missing values/invalid periods. Evidence: `services/calculations/`.
- [x] **09.02** Snapshot builder, versioned publisher/repository and authenticated reader endpoint exist. Evidence: `services/reporting/`, `services/supabase/report-snapshot*`.
- [x] **09.03** Snapshot payloads support holdings/history/income/gains plus separate activity/price coverage fields.
- [x] **09.04** Compose persisted effective ledger, opening history, calendar, validated actions and selected stored prices into report inputs; use corrected chronological replay from step 06. `composePersistedReportInputs` now performs this deterministic composition and derives the import revision.
- [ ] **09.05** Wire report queue handler and import/undo/price-correction triggers through publication; reject stale workers and make retry/snapshot revision selection deterministic.
- [ ] **09.06** Generate consolidated views that cancel linked internal transfers while excluding external flows and incentives; preserve unknown basis and incomplete return periods.
- [ ] **09.07** Validate return/gain definitions and disclose daily flow timing approximation; do not bridge gaps, annualize short periods or imply tax calculations.
- [ ] **09.08** Gate: upload → commit → queue → stored report completes without manually supplying a snapshot; undo/correction regenerates matching results and previous revisions remain reproducible.

## 10 — Finish the usable portfolio experience

Owner: product UI. Depends on step 09.

- [x] **10.01** Approved landing/sign-in/demo design, compass asset, navigation and $5/month/$49/year pricing copy exist.
- [x] **10.02** Live overview reads snapshots/freshness, renders holdings/value history/income/cash/gains where supplied, and has account selection plus loading/error/retry/awaiting-report states. Synthetic activity is hidden for authenticated users.
- [x] **10.03** Persisted import review/history/commit/discard/latest-only undo controls exist; public skip links and active-navigation labels exist.
- [x] **10.04** Implement persisted activity list with pagination/filtering and ledger-to-source-row detail. The authenticated Activity view now uses the account-scoped API with loading, empty, error, retry and pagination states; demo activity remains isolated.
- [ ] **10.05** Finish value/return period controls, consolidated/account selection, allocation, invested capital/net deposits, dividend and realized-lot detail views.
- [ ] **10.06** Complete opening-history and actionable warning flows; distinguish no holdings, missing report, stale report, partial history and unavailable prices without synthetic fallback.
- [ ] **10.07** Verify dialog focus/keyboard/screen-reader behavior, accessible tables, mobile layouts and 200% enlargement across authenticated flows.
- [ ] **10.08** Audit any retained WebMCP hooks against actual authorized app actions/state; remove unsupported claims or obsolete hooks.
- [ ] **10.09** Gate: authenticated browser fixture flows reconcile displayed numbers to stored records; every enabled action works and logout/account switching cannot leak prior account values.

## 11 — Implement real trial and subscription lifecycle

Owner: billing. Depends on usable reports in step 09; retain planned $5 monthly/$49 annual pricing.

- [x] **11.01** Pure first-usable-import 14-day no-card trial and duplicate-event entitlement reducers exist. Evidence: `services/billing/entitlements.ts`.
- [ ] **11.02** Persist one-time trial start atomically after the first usable committed import; retries, undo or another account must not restart it.
- [ ] **11.03** Configure Stripe test products/prices, Checkout and Billing Portal endpoints with authenticated customer ownership.
- [ ] **11.04** Verify webhook signatures on raw bodies and persist replay/event-order protection. Current reducer only deduplicates IDs; out-of-order subscription events can overwrite newer state.
- [ ] **11.05** Enforce entitlement server-side; implement expiration, payment failures, plan changes/cancellation and truthful billing/trial UI.
- [ ] **11.06** Gate: Stripe test lifecycle and invalid/duplicate/reordered webhook tests pass; export/deletion remain accessible after cancellation.

## 12 — Execute privacy and operational safeguards

Owner: privacy/platform. Depends on working storage, reports and billing.

- [x] **12.01** Pure 30-day raw-file retention rules and deletion lifecycle/cleanup contracts exist. Evidence: `services/privacy/`.
- [ ] **12.02** Run scheduled private-object retention with durable audit, retries and verified deletion; retain normalized product activity as specified.
- [ ] **12.03** Add safe self-service transaction/report CSV export, including spreadsheet-formula escaping and access after cancellation.
- [ ] **12.04** Implement user/data deletion across auth, storage, accounts, reports and billing; revoke access and handle partially failed cleanup.
- [ ] **12.05** Complete settings UI for exports, deletion and billing; publish accurate privacy/terms and retention explanations.
- [ ] **12.06** Enforce rate limits, request validation, redacted logs, least-privilege roles and secret handling across all execution paths.
- [ ] **12.07** Add actionable import/queue/report/provider monitoring; configure backups and document a successful restore drill with recovery targets.
- [ ] **12.08** Gate: actual retention/export/deletion and restore tests pass in an isolated environment; canceled/deleted-user behavior is verified.

## 13 — Prove the complete MVP and prepare deployment

Owner: integration/platform. Depends on all earlier acceptance gates.

- [ ] **13.01** Run real database/RLS/storage and authenticated Playwright suites in CI alongside unit/typecheck/build; install required browser/runtime dependencies.
- [ ] **13.02** Verify signup → account → upload → resolve/review → commit → accurate dashboard → trial → billing with representative brokerage and IRA files.
- [ ] **13.03** Run adversarial regression cases: cross-user IDs, session expiry, concurrent import/undo, duplicate DRIP, split chronology, unavailable prices, queue replay, quota concurrency and webhook ordering.
- [ ] **13.04** Configure and verify hosted Supabase/auth, API origins, Worker queues/cron/secrets, storage, retention and Stripe in staging; document deployed revisions.
- [ ] **13.05** Choose final product name/domain, check conflicts, and apply/verify logo/favicon consistently. Northstar remains the working name.
- [ ] **13.06** Confirm production market-data storage/display rights and an approved commercial plan before paid launch; free Marketstack remains development-only unless verified rights establish otherwise. Do not upgrade automatically.
- [ ] **13.07** Verify operating costs against $45–75/month before marketing, escalating estimates above $100; use current provider allowances/prices rather than old planning assumptions.
- [ ] **13.08** Gate: record all passing launch evidence, production configuration, recovery/rollback procedure and deployed version before inviting paying users.

## External inputs and scope

Request missing external inputs when their step is ready: additional sanitized IRA/brokerage coverage (03.05), data provenance/rights evidence (07.04), a free development Marketstack key (08.07), OAuth target configuration (02.07), Stripe test configuration (11.03), and hosted service/domain access (13.04–13.06). Existing credentials were not inspected in this audit; do not assume they are missing.

MVP scope: USD long U.S. stocks/ETFs, fractional shares, cash, Robinhood activity CSVs for individual/traditional/Roth accounts; $5/month or $49/year with a 14-day no-card trial after the first usable import. Unknown basis/history stays explicit; no tax or investment advice.

Deferred: Plaid and other brokerages, PDFs/OCR, 401(k), crypto/options/margin/shorts, FX, wash sales/tax filing, benchmarks, money-weighted returns, recommendations, forecasting, households, banking and budgeting. Keep typed provider/import interfaces for expansion.

## Audit and future milestone log

| Date | Scope | Evidence | Limits |
| --- | --- | --- | --- |
| 2026-09-10 | Checklist re-audit at `60ba90a` | Read API/UI, migrations, queue/price/report/ledger/billing paths and test/CI setup; reran typecheck and Vitest: 50 files / 160 tests passed. Replaced stale status summary, split implementation from integration gates, added concrete correctness work, and reordered dependencies. | Documentation only; no fixes, hosted/database/storage/provider/browser execution or license clearance claimed. |
| 2026-09-10 | 04.04 — Safe replay of undone imports | Commit `fe0bf6a`; active-import-only file-hash checks, fingerprint cleanup for undone derived rows, and regression coverage added. Import repository tests (7), typecheck and diff check passed. | Account-level commit serialization and unknown-result idempotency remain open. |
| 2026-09-10 | 08.04 — Skip cached daily closes | Commit `c427531`; daily refresh now asks persistence for missing symbols before provider calls and reports `already_fetched` when all closes exist. Focused market-data/Supabase tests (13) and typecheck passed. | Atomic concurrent claims, exact quota reservation/accounting and live provider execution remain open. |
| 2026-09-10 | 08.05 — Accurate refresh telemetry (partial) | Commit `9bea693`; skipped runs no longer count as provider quota, and retries count only actual provider attempts. Focused market-data tests (15) and typecheck passed. | Atomic reservation across concurrent workers, durable provider-request reconciliation and alerts remain open. |
| 2026-09-10 | 09.04 — Persisted report input composition | Commit `20e6a26`; composed committed ledger replay, opening lots, selected closes, validated actions and valuation dates into deterministic report inputs with coverage and import revision metadata. Two focused tests and typecheck passed. | Report queue execution and snapshot publication triggers remain open. |
| 2026-09-10 | 10.04 — Authenticated activity reader and dashboard | Commit `b816682`; wired paginated account activity and source-row details into the authenticated dashboard with loading, empty, error, retry and navigation states. Typecheck, full Vitest (172 tests), build and diff check passed. | Richer detail views and live authenticated browser coverage remain open. |
| 2026-09-10 | 10.04 — Activity filtering | Added an accessible client-side filter for activity type, instrument ID and description, with a distinct no-match state. Typecheck and full Vitest (172 tests) passed. | Server-side filtering and live authenticated browser coverage remain open. |
| 2026-09-10 | 05.04 — Cloudflare queue adapter boundary (partial) | Commit `cd73fcc`; Worker now exports a typed queue adapter that validates and dispatches batches, acknowledges malformed poison messages, and retries valid jobs until durable handlers are configured. Queue tests (6), typecheck and diff check passed. | Durable import/report/price handlers, outbox dispatch and dead-letter inspection remain open. |
| 2026-09-10 | 11.04 — Billing webhook ordering (partial) | Commit `35afd23`; entitlement events now ignore older events and deterministically order equal timestamps, with an auditable event table and RLS policy. Full tests (177), typecheck, build and diff check passed. | Stripe raw-body signature verification and HTTP endpoint integration remain open. |
| 2026-09-10 | 09.05 — Report queue worker (partial) | Commit `601e013`; dependency-injected report jobs load composed inputs, validate ownership, recheck freshness around valuation, publish idempotently and retry transient failures. Eight focused queue/report tests and typecheck passed. | Cloudflare handler wiring, durable input loaders, outbox triggers and live snapshot execution remain open. |
| 2026-09-10 | 11.04 — Stripe raw webhook boundary (partial) | Commit `6c1f2e3`; raw-body HMAC verification, timestamp tolerance, secret rotation signatures, strict event validation and authenticated HTTP dispatch are covered by API/billing tests. | Durable event persistence through the HTTP handler, Stripe Checkout/Portal and live secrets remain open. |

Earlier implementation history is preserved in [docs/IMPLEMENTATION_HISTORY.md](docs/IMPLEMENTATION_HISTORY.md). Its old checkmarks/limits are historical, not current status. For each future milestone, record stable task IDs, commit, tests and remaining limits here; update counts only for this file's task lines.
