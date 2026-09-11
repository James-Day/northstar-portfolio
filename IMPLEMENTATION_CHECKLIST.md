# Portfolio tracker implementation checklist

Last audited: September 10, 2026. Source baseline: `e674210`.

## How to use this checklist

This file is the current implementation plan. Work through the numbered steps in order, taking the first unchecked task within each step. Check off only the exact deliverable described. Each step ends with a separate acceptance gate: working building blocks do not imply an integrated feature is complete.

- `[x]` = implementation exists and has supporting code/test evidence for the stated scope.
- `[ ]` = implementation, correction, integration, or verification remains.
- Checked tasks are deliberately narrow. Local verification does not prove hosted deployment.
- Stable IDs such as **04.03** are used in future work logs. Do not renumber existing IDs when adding tasks.
- Keep commits large and coherent. Record meaningful milestone evidence rather than a log entry for every small UI change.
- Never commit secrets. Configure credentials through local ignored environment files or the service's secret interface.

**Current count: 102 tasks — 64 checked, 38 unchecked, across 13 ordered steps.**

**Progress view:** 85 tasks have implementation or verification evidence (67 complete and 18 partial); 17 tasks still have no documented progress. Partial evidence never substitutes for the acceptance gates below.

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
| Billing/privacy | Pure entitlement, trial, retention and deletion rules; authenticated activity/report exports; idempotent deletion-plan persistence | Durable effects, Stripe HTTP integration, enforcement, export/deletion UI |
| Tests | Typecheck and 238 tests across 67 files pass in the current audit | Real database, storage and authenticated browser regression suites |

No hosted services, price datasets, provider credentials, or commercial licensing were reverified in this documentation audit. Previous local Supabase integration evidence is retained in [the historical log](docs/IMPLEMENTATION_HISTORY.md); it is not a fresh live test.

## 01 — Establish a reproducible development and verification baseline

Owner: platform/integration. Start here; later steps rely on a repeatable local database and API.

- [x] **01.01** Repository, React/TypeScript/Tailwind UI, module boundaries, decimal-string/date/instrument contracts exist. Evidence: `package.json`, `services/module-boundaries.ts`, `lib/domain/`.
- [x] **01.02** Local Supabase configuration, migrations, private bucket/RLS definitions and setup documentation exist. Evidence: `supabase/`, `README.md`.
- [x] **01.03** Standalone Hono API Worker, cron/queue declarations, environment template and server-side provider configuration exist. Evidence: `workers/api.ts`, `wrangler.api.toml`, `.env.example`.
- [x] **01.04** CI runs typecheck, Vitest and build; Playwright scripts and three public-page tests exist. Evidence: `.github/workflows/checks.yml`, `tests/e2e/public-pages.spec.ts`. Browser tests are not yet in CI.
- [ ] **01.05** Add a repeatable local integration harness: reset/apply migrations, seed two isolated users plus instrument aliases, start API/frontend, and clean up test data. The harness supports installed or `npx` Supabase CLI execution and fails safely with captured Docker diagnostics; read `docs/DOCKER_WINDOWS_RECOVERY.md` before Docker repairs.
- [ ] **01.06** Automate database constraints/RLS tests for every user-owned table, private objects and service-only global writes; test guessed IDs and direct database writes, not only mocked repositories.
- [ ] **01.07** Gate: run the documented workflow from a fresh checkout and record migration, database-isolation, typecheck, unit and build results. Confirm browser output excludes service/provider secrets.

## 02 — Finish identity and account access

Owner: identity/accounts. Depends on step 01.

- [x] **02.01** Email/password signup/sign-in/sign-out, Google initiation and password-reset initiation boundaries exist; sign-in and callback screens use configured Supabase. Evidence: `services/auth/`, `components/sign-in-page.tsx`, `components/auth-callback-page.tsx`.
- [x] **02.02** Existing private API endpoints verify bearer sessions; account/import queries use user RLS or explicit ownership checks. Evidence: `services/api/app.ts`, `services/auth/server-session.ts`.
- [x] **02.03** Authenticated account naming/creation for brokerage, traditional IRA and Roth IRA, listing, selection and load-error retry UI exist. Evidence: `components/portfolio-app.tsx`, `services/accounts/`.
- [x] **02.04** Signed-in shell uses session identity and an account-workspace label; public synthetic demo is labeled separately. Evidence: `components/portfolio-app.tsx`.
- [ ] **02.05** Separate private workspace routing from public demo; enforce server-side access where private pages are served and show an explicit session-loading state.
- [x] **02.06** Complete recovery password submission and verify signup verification, session renewal, logout/revocation and account switching; clear private cached UI data on session changes. Evidence: dedicated recovery page, validated password update, global sign-out, identity-change cache clearing and account-switch cleanup in commit `b4d361a`.
- [ ] **02.07** Configure/verify Google and email redirects in the target environment, including final origin and invalid callback handling.
- [ ] **02.08** Gate: two real local users can create/select each supported account type; invalid/revoked sessions cannot read private account data in API or browser flows.

## 03 — Make imported activity trustworthy

Owner: ingestion. Depends on steps 01–02.

- [x] **03.01** CSV parsing supports quoting, multiline fields, BOMs, official footer/blank records, strict dates/decimals/headers and server parser limits of 10 MB/50,000 rows. Evidence: `services/ingestion/robinhood.ts` and tests.
- [x] **03.02** Supported activity mappings, raw-row/error preservation, SHA-256/parser metadata and unsupported-row blocking exist. Evidence: `services/ingestion/staging.ts`, `ledger-normalization.ts`.
- [x] **03.03** A sanitized regression sample derived from supplied-export cases exists. Evidence: `fixtures/robinhood/activity-sample.csv`; this is not full brokerage/IRA acceptance.
- [x] **03.04** User confirms an owned account for persisted imports; account-scoped preview/staging and review/history APIs exist. Evidence: `services/api/app.ts`, `services/supabase/imports-repository.ts`.
- [x] **03.05** Add representative sanitized individual, traditional IRA and Roth IRA exports with independent row-level expected results. Evidence: `fixtures/robinhood/`, `services/ingestion/robinhood.test.ts`, `services/ingestion/ledger-normalization.test.ts`, commits `9d800e0` and `39c7209`; all three account types have row-level parser expectations.
- [ ] **03.06** Reconcile actual dividend/reinvestment CSV semantics so separately reported dividends plus buys never create a second dividend; verify fees, transfers, incentives and fractional activity across parser, SQL and calculation paths.
- [ ] **03.07** Add durable issue resolution or explicit non-reportable handling for unsupported rows, missing aliases and incomplete history; never silently dismiss material blockers.
- [ ] **03.08** Gate: accepted fixtures reconcile every row, quantity and cash amount; malformed values and unsupported assets cannot produce an apparently complete account.

## 04 — Correct transactional commit, overlap detection and undo

Owner: ingestion/database. Depends on step 03. Finish before trusting persisted positions.

- [x] **04.01** Atomic staging, source-row retention, commit RPC, latest-import undo RPC and outbox inserts exist. Evidence: staging/commit/undo migrations and `services/supabase/imports-repository.ts`.
- [x] **04.02** Multiplicity-aware fingerprint helpers and SQL overlap checks exist; review/history/commit/discard/latest-only undo UI is connected. Evidence: `services/ingestion/deduplication.ts`, `components/portfolio-app.tsx`.
- [ ] **04.03** Serialize commits/undo at account level. Advisory-lock wrappers now serialize mutations for the same account while preserving per-account ownership checks; live database concurrency still needs to prove overlapping commits preserve intended multiplicity.
- [x] **04.04** Exclude undone imports from effective duplicate counts and define identical-file reimport/retry behavior. The replay migration filters active imports, clears fingerprints from undone derived rows, and repository tests cover status filtering.
- [x] **04.05** Make repeated commit/undo requests return stable outcomes, including retries after an unknown network result; test same-file staging races and fingerprint canonicalization across TS/SQL. Evidence: `services/supabase/imports-repository.ts`, `services/supabase/imports-repository.test.ts`, `services/ingestion/deduplication.test.ts`; retry convergence, concurrent staging conflict recovery, and multiplicity-aware fingerprints are covered.
- [ ] **04.06** Preserve original parsing evidence when deriving duplicate/review statuses; enforce permitted mutations and transition rules against direct client writes as well as API calls.
- [ ] **04.07** Gate: database tests cover repeated files/trades, overlapping exports, concurrent requests, undo/reimport and rollback on blockers. Undo restores effective activity while preserving audit records.

## 05 — Complete private uploads and background execution

Owner: platform/ingestion. Depends on step 04; queue consumers must use the corrected transaction rules.

- [x] **05.01** Private bucket policies and owned-account signed-upload API/repository exist. Evidence: initial migration, `services/supabase/signed-upload-repository.ts`.
- [x] **05.02** Typed import/report/price jobs and retry-aware dispatcher exist. Evidence: `services/queues/`. Worker has no `queue` export or durable handlers yet.
- [x] **05.03** Upload the actual object, bind verified object metadata/hash to its import, enforce streamed request limits and validate ownership/size/content server-side before processing. Evidence: authenticated object-binding endpoint, private Storage download, exact byte/hash verification, ownership checks, and RLS-backed binding RPC in commit `1c8f694`.
- [x] **05.04** Wire Cloudflare queue entrypoint and durable import handler; persist processing/progress/failure state and let browser review poll durable results. Evidence: import queue handler, Supabase claim/progress/complete/fail RPCs, Worker queue binding and durable import repository in commit `b77c092`.
- [x] **05.05** Dispatch the transactional outbox with claim/retry/idempotency semantics. The dispatcher claims with `FOR UPDATE SKIP LOCKED`, translates `import.committed`/`import.undone` to typed report jobs, verifies ownership, and records retry/failure state.
- [x] **05.06** Persist rejected-job/error evidence before acknowledgment; implement dead-letter inspection and safe replay. Evidence: queue failure recorder, RLS/service-only rejection repository, durable rejection/replay RPCs and queue integration in commit `b77c092`.
- [ ] **05.07** Gate: real storage isolation and queued import tests pass; retry/crash never loses an upload, commits twice or silently drops failed work.

## 06 — Reconcile persisted accounting and opening history

Owner: ledger/calculations. Depends on steps 04–05.

- [x] **06.01** Pure decimal FIFO/cash/fee/dividend/unknown-basis calculations exist with fixtures. Evidence: `services/ledger/fifo.ts` and tests.
- [x] **06.02** Opening cash/position/lot validation contracts exist. Evidence: `services/accounts/opening-history.ts`.
- [x] **06.03** Transfer matching/basis-preserving lot helpers and validated corporate-action guards exist. Evidence: `services/ledger/transfers.ts`, `corporate-actions.ts`. These do not prove persisted execution.
- [x] **06.04** Persist/edit opening cash and known/unknown lots through owned APIs/UI; mark incomplete cost basis/return coverage without inventing dates or basis. Evidence: `services/accounts/opening-history.ts`, `services/supabase/opening-history-repository.ts`, `services/api/app.ts`, `components/portfolio-app.tsx`, and `supabase/migrations/20260910210000_opening_history.sql`.
- [x] **06.05** Build an authoritative loader/replay of only effective committed ledger events plus opening history; use deterministic same-day ordering and reconcile SQL normalization to engine contracts. Evidence: `services/ledger/persisted-replay.ts`, `services/ledger/persisted-replay.test.ts`; committed-import filtering, opening lots, signed SQL amounts, and stable date/ID ordering are covered.
- [x] **06.06** Rebuild/persist lot quantities and realized matches after buys, sales and undo. Evidence: deterministic account rebuild, FIFO sale consumption, proportional cost-basis matches, over-sale validation, and serialized commit/undo integration in commit `a103071`.
- [x] **06.07** Apply splits in chronological event order, before later trades. Evidence: `services/calculations/valuation.ts`, `services/calculations/valuation.test.ts`, commit `18482fc`; buy → split → buy/sell chronology is covered by a regression fixture.
- [x] **06.08** Persist and execute reconciled cross-account cash/share transfers, preserve basis/dates, and keep unresolved transfers explicit. Preserve stable instrument identity across ticker aliases. Evidence: deterministic transfer reconciliation, alias resolution, explicit unresolved states, owned repository and RLS table in commit `504a2a4`.
- [ ] **06.09** Gate: database-derived cash, positions, FIFO gains, fees, DRIP, transfers and splits reconcile to independent fixtures before and after undo. Analytical gains are labeled “not tax reporting.”

## 07 — Establish trusted historical prices

Owner: market data. Depends on instrument identity in step 06; licensing research may proceed earlier.

- [x] **07.01** Bounded DoltHub reader/ingestion coordinator, revision checks and date-effective alias resolution exist. Evidence: `services/market-data/dolthub.ts`, `historical-ingestion.ts`.
- [x] **07.02** Unadjusted close/revision writers and evidence-bearing correction resolver/writer exist. Evidence: `services/supabase/historical-prices-repository.ts`, `services/market-data/price-corrections.ts`.
- [x] **07.03** Invalid/duplicate/extreme-close quarantine and missing-session/alias-gap checks exist. Evidence: `services/market-data/quality.ts`, historical-ingestion tests.
- [ ] **07.04** Record dataset version, actual license, attribution/share-alike requirements and upstream provenance evidence; resolve rights for intended paid storage/display before user-facing use. Do not treat spot checks as licensing clearance.
- [x] **07.05** Add a runnable resumable seed job with durable cursor, instrument mapping, quarantine storage and operator review; execute a bounded seed and record rows/revision. Evidence: resumable DoltHub seed runner, durable job state/mappings/quarantine migration and repository boundary in commit `8b4bb54`.
- [ ] **07.06** Independently verify representative stocks, ETFs, delisted names, ticker transitions and split boundaries; record expected/actual values and source evidence. Keep dividends sourced from brokerage activity. Added `verifyHistoricalCases` to compare operator-supplied fixtures without mutating source prices; independent fixture values and evidence still need to be populated and reviewed.
- [x] **07.07** Prevent same-version price/correction overwrite; select authoritative revisions deterministically and track all source/correction dependencies needed to reproduce a report. Evidence: immutable revision triggers, fail-closed same-version conflict detection, explicit provider/correction precedence and report dependency payloads in commit `cb1a7d9`.
- [ ] **07.08** Gate: repeat seed is safe, quarantined data cannot value portfolios, and representative stored prices are independently verified and traceable.

## 08 — Make daily pricing safe on the free development allowance

Owner: market data/platform. Depends on steps 06–07.

- [x] **08.01** Server-only Marketstack provider, decimal responses and configurable budget exist. Evidence: `services/market-data/marketstack.ts`.
- [x] **08.02** New York EOD/standard-holiday guard, unique-symbol reader, response validation, retry/backoff, storage writer and scheduled Worker composition exist. Evidence: `workers/api.ts`, `services/market-data/daily-refresh.ts`, `services/supabase/active-symbols-repository.ts`.
- [x] **08.03** Durable run metrics, monthly usage reader, preflight cap and freshness classifiers/read API/UI exist. These are foundations, not a proven hard quota guarantee.
- [x] **08.04** Skip already-fetched symbol/trading-date closes before calling the provider. Daily-price persistence exposes a missing-symbol lookup, the refresh coordinator returns an explicit `already_fetched` skip, and tests cover fully and partially cached batches. Durable concurrent claims remain part of 08.05.
- [x] **08.05** Fix request accounting: skipped runs currently emit attempt symbol counts that become quota units; reserve budget atomically before actual calls, reconcile attempts/failures and prevent concurrent overspend. Evidence: `services/market-data/quota.ts`, `services/market-data/daily-refresh.ts`, `services/supabase/market-data-quota-repository.ts`, and `supabase/migrations/20260910200000_market_data_quota_reservations.sql`; focused success/failure/exhaustion tests pass.
- [x] **08.06** Add paginated active-position/alias reads and provider-sized batches, explicit unresolved aliases, delayed-publication handling and gap backfills. Verify extraordinary calendar closures and session overrides. Evidence: `services/supabase/active-symbols-repository.ts`, `services/market-data/marketstack.ts`, `services/market-data/historical-ingestion.ts`, `services/market-data/calendar-config.ts`, `services/market-data/us-equity-calendar.ts`, scheduled/daily refresh tests, and commits `be38fc0`, `193e8fe`, `a68a5f1`, `600905f`, `db42444`.
- [ ] **08.07** Configure a free development key, confirm its current allowance, and run a deliberately tiny live fetch into the database. Keep automatic schedules off until 08.04–08.05 pass; no purchase/upgrade.
- [x] **08.08** Deliver quota/failure/stale-price alerts and durable recovery visibility; test provider outage and partial responses without fabricating closes. Evidence: `services/market-data/refresh-metrics.ts`, `services/platform/operational-status.ts`, durable `market_data_job_runs` telemetry, stale-price/read APIs, and focused provider failure/partial-response/quota tests.
- [x] **08.09** Gate: two users with one shared holding cause one symbol/date fetch; repeated/concurrent cron and dashboard loads add no redundant calls; free cap is enforced across retries. Evidence: duplicate-lot coalescing in `services/supabase/active-symbols-repository.ts`, Durable Object refresh claims in `services/market-data/refresh-claim-do.ts`, database-backed dashboard reads, and focused active-symbol/claim/scheduler/quota tests.

## 09 — Generate reproducible reports automatically

Owner: reporting/calculations. Depends on steps 05–08.

- [x] **09.01** Daily valuation and Modified Dietz/chain functions exist, excluding contributions/incentives and exposing missing values/invalid periods. Evidence: `services/calculations/`.
- [x] **09.02** Snapshot builder, versioned publisher/repository and authenticated reader endpoint exist. Evidence: `services/reporting/`, `services/supabase/report-snapshot*`.
- [x] **09.03** Snapshot payloads support holdings/history/income/gains plus separate activity/price coverage fields.
- [x] **09.04** Compose persisted effective ledger, opening history, calendar, validated actions and selected stored prices into report inputs; use corrected chronological replay from step 06. `composePersistedReportInputs` now performs this deterministic composition and derives the import revision.
- [x] **09.05** Wire report queue handler and import/undo/price-correction triggers through publication; reject stale workers and make retry/snapshot revision selection deterministic. Evidence: `services/reporting/report-queue-handler.ts`, `supabase/migrations/20260911110000_report_trigger_deduplication.sql`, `services/reporting/report-trigger-contract.test.ts`, commit `adfe917`.
- [x] **09.06** Generate consolidated views that cancel linked internal transfers while excluding external flows and incentives; preserve unknown basis and incomplete return periods. Evidence: `composeConsolidatedReportInputs` cancels only proven links, keeps unresolved transfers explicit, and preserves incomplete valuations/unknown basis in commit `01afe90`.
- [x] **09.07** Validate return/gain definitions and disclose daily flow timing approximation; do not bridge gaps, annualize short periods or imply tax calculations. Evidence: typed methodology metadata, midpoint flow disclosure, non-contiguous period handling, and explicit analytical/not-tax-reporting labels in commit `6a3718c`.
- [ ] **09.08** Gate: upload → commit → queue → stored report completes without manually supplying a snapshot; undo/correction regenerates matching results and previous revisions remain reproducible. Local integration coverage now composes committed ledger inputs and stored prices through the queue publisher; live Supabase/storage execution remains required.

## 10 — Finish the usable portfolio experience

Owner: product UI. Depends on step 09.

- [x] **10.01** Approved landing/sign-in/demo design, compass asset, navigation and $5/month/$49/year pricing copy exist.
- [x] **10.02** Live overview reads snapshots/freshness, renders holdings/value history/income/cash/gains where supplied, and has account selection plus loading/error/retry/awaiting-report states. Synthetic activity is hidden for authenticated users.
- [x] **10.03** Persisted import review/history/commit/discard/latest-only undo controls exist; public skip links and active-navigation labels exist.
- [x] **10.04** Implement persisted activity list with pagination/filtering and ledger-to-source-row detail. The authenticated Activity view now uses the account-scoped API with loading, empty, error, retry and pagination states; demo activity remains isolated.
- [x] **10.05** Finish value/return period controls, consolidated/account selection, allocation, invested capital/net deposits, dividend and realized-lot detail views. Evidence: period/scope controls and allocation metrics in `components/portfolio-app.tsx`; persisted snapshot dividend and realized-event payloads in `services/reporting/snapshot-builder.ts`; dated dividend and FIFO lot detail states in the authenticated dashboard.
- [x] **10.06** Complete opening-history and actionable warning flows; distinguish no holdings, missing report, stale report, partial history and unavailable prices without synthetic fallback. Evidence: typed warning classifier and authenticated Overview actions for import, opening-history review and retry in commits `4176951` and `dda6349`.
- [ ] **10.07** Verify dialog focus/keyboard/screen-reader behavior, accessible tables, mobile layouts and 200% enlargement across authenticated flows. Public landing/sign-in/demo surfaces now have a 375px keyboard/overflow regression in `tests/e2e/public-pages.spec.ts`, and the report grid constrains tables to scroll within cards; authenticated dialogs, tables and 200% enlargement remain to be verified.
- [x] **10.08** Audit any retained WebMCP hooks against actual authorized app actions/state; no WebMCP hooks or unsupported action claims are retained. Evidence: `docs/WEBMCP_AUDIT.md`.
- [ ] **10.09** Gate: authenticated browser fixture flows reconcile displayed numbers to stored records; every enabled action works and logout/account switching cannot leak prior account values.

## 11 — Implement real trial and subscription lifecycle

Owner: billing. Depends on usable reports in step 09; retain planned $5 monthly/$49 annual pricing.

- [x] **11.01** Pure first-usable-import 14-day no-card trial and duplicate-event entitlement reducers exist. Evidence: `services/billing/entitlements.ts`.
- [x] **11.02** Persist one-time trial start atomically after the first usable committed import. The commit trigger and security-definer RPC create the trial once; retries, undo or another account cannot restart an existing trial.
- [ ] **11.03** Configure Stripe test products/prices, Checkout and Billing Portal endpoints with authenticated customer ownership. Launch preflight now validates optional recorded amounts against 500 monthly cents / 4900 annual cents and fails production when amounts are missing or wrong; live Stripe test-product creation and endpoint verification remain open.
- [x] **11.04** Verify webhook signatures on raw bodies and persist replay/event-order protection. Evidence: raw-body HMAC verification, strict event validation, durable payload/audit handling, server-controlled customer ownership lookup, and lifecycle handler dispatch in commit `368c349`.
- [x] **11.05** Enforce entitlement server-side; implement expiration, payment failures, plan changes/cancellation and truthful billing/trial UI. Evidence: request-time entitlement gate for reports/freshness, trial expiration handling, billing status endpoint and subscription status UI in commit `c7fe907`.
- [ ] **11.06** Gate: Stripe test lifecycle and invalid/duplicate/reordered webhook tests pass; export/deletion remain accessible after cancellation.

## 12 — Execute privacy and operational safeguards

Owner: privacy/platform. Depends on working storage, reports and billing.

- [x] **12.01** Pure 30-day raw-file retention rules and deletion lifecycle/cleanup contracts exist. Evidence: `services/privacy/`.
- [ ] **12.02** Run scheduled private-object retention with durable audit, retries and verified deletion; retain normalized product activity as specified.
- [x] **12.03** Add safe self-service transaction/report CSV export, including spreadsheet-formula escaping and access after cancellation. Evidence: `services/api/app.ts`, `services/privacy/export.ts`, `components/settings-panel.tsx`, and pagination/formula-escaping coverage in `services/api/app.test.ts`.
- [ ] **12.04** Implement user/data deletion across auth, storage, accounts, reports and billing; revoke access and handle partially failed cleanup.
- [x] **12.05** Complete settings UI for exports, deletion and billing; publish accurate privacy/terms and retention explanations. Evidence: `components/settings-panel.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`, commit `7ddffaf`.
- [ ] **12.06** Enforce rate limits, request validation, redacted logs, least-privilege roles and secret handling across all execution paths. API and Worker paths now emit injectable redacted request metadata with pathname-only logging, enforce shared Durable Object limits when configured, and keep provider/database secrets server-side; hosted execution-role verification remains open.
- [ ] **12.07** Add actionable import/queue/report/provider monitoring; configure backups and document a successful restore drill with recovery targets. Secret-free operational status and a repository-side drill procedure now exist in `services/platform/operational-status.ts` and `docs/BACKUP_RESTORE_DRILL.md`; a hosted backup, restore, reconciliation and alert delivery run remains required.
- [ ] **12.08** Gate: actual retention/export/deletion and restore tests pass in an isolated environment; canceled/deleted-user behavior is verified.

## 13 — Prove the complete MVP and prepare deployment

Owner: integration/platform. Depends on all earlier acceptance gates.

- [ ] **13.01** Run real database/RLS/storage and authenticated Playwright suites in CI alongside unit/typecheck/build; install required browser/runtime dependencies.
- [ ] **13.02** Verify signup → account → upload → resolve/review → commit → accurate dashboard → trial → billing with representative brokerage and IRA files.
- [ ] **13.03** Run adversarial regression cases: cross-user IDs, session expiry, concurrent import/undo, duplicate DRIP, split chronology, unavailable prices, queue replay, quota concurrency and webhook ordering.
- [ ] **13.04** Configure and verify hosted Supabase/auth, API origins, Worker queues/cron/secrets, storage, retention and Stripe in staging; document deployed revisions.
- [ ] **13.05** Choose final product name/domain, check conflicts, and apply/verify logo/favicon consistently. Northstar remains the working name.
- [ ] **13.06** Confirm production market-data storage/display rights and an approved commercial plan before paid launch; free Marketstack remains development-only unless verified rights establish otherwise. Do not upgrade automatically.
- [x] **13.07** Verify operating costs against $45–75/month before marketing, escalating estimates above $100; use current provider allowances/prices rather than old planning assumptions. Evidence: integer-cent budget assessment, current Marketstack plan table, 20% reserve capacity calculation, environment thresholds and documentation in commit `a879f23`.
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
| 2026-09-10 | 05.05 — Transactional outbox dispatch | Commit `27599b6`; durable claim, ownership verification, typed report-job publication, completion, exponential retry and permanent failure RPCs are implemented and tested. Full Vitest (197 tests) and typecheck passed. | Live queue binding and report/price-correction trigger execution remain open. |
| 2026-09-10 | 11.03 — Authenticated Stripe Checkout/Portal boundary (partial) | Commit `86f6863`; authenticated checkout and billing-portal endpoints select server-configured plan IDs, construct same-origin return URLs and validate provider URLs. Focused billing/API tests (30) passed. | Stripe product configuration, live customer adapter and entitlement enforcement remain open. |
| 2026-09-10 | 12.03 — Safe CSV export utility (partial) | Added formula-neutralizing RFC 4180 cell escaping and rectangular CSV serialization with focused tests. | Authenticated export endpoint, settings UI and cancellation-access verification remain open. |
| 2026-09-10 | 12.03 — Authenticated activity CSV export (partial) | Added an account-owned `GET /v1/accounts/:accountId/activity.csv` endpoint using the safe serializer; API coverage verifies session/ownership, CSV content type and formula neutralization. | Report export, pagination beyond the first 100 rows, settings UI and cancellation-access verification remain open. |
| 2026-09-10 | 09.05 — Price-to-report trigger (partial) | Commit `545d193`; daily-price inserts now create deduplicated account-scoped `price.updated` outbox events, and the dispatcher maps them to idempotent `report.recompute` jobs. Four focused dispatcher tests passed. | Deployed queue consumption, price-correction triggers and live report execution remain open. |
| 2026-09-10 | 10.05 — Report period and scope controls (partial) | Commit `e54b993`; authenticated Overview supports 1 month, 3 months, YTD, 1 year and all-time chart windows, preserves unavailable points, and exposes a disabled consolidated scope until snapshots exist. Three focused tests and typecheck passed. | Allocation/detail cards and actual consolidated snapshots remain open. |
| 2026-09-10 | 12.02 — Durable raw-file retention worker (partial) | Commit `2802a22`; durable claim/audit/retry/exhaustion RPCs, private Storage deletion/verification, crash recovery and safe path validation are implemented and tested. Seven focused retention tests and typecheck passed. | Scheduled deployment and live Storage execution remain open. |
| 2026-09-10 | 11.02 — Atomic trial persistence | Added billing persistence contracts/repository and migration RPCs/triggers for one-time trial creation after a committed import, plus repository coverage. | Live Supabase billing execution and entitlement enforcement remain open. |
| 2026-09-10 | 12.03/12.05 — Settings export and privacy actions (partial) | Added authenticated Settings navigation with account-scoped activity/report CSV downloads, formula-safe export messaging, Stripe billing portal action, retention explanation and deletion-request confirmation. Added `GET /v1/accounts/:accountId/report.csv` and an explicit `POST /v1/me/deletion-request` boundary that returns `deletion_unavailable` until a durable executor is configured. API tests cover report CSV shape and safe unavailable deletion behavior; typecheck passed. | At the time of this entry, activity export was capped at the API page size; this was completed by the later 12.03 export milestone. Durable deletion executor, cancellation-access verification, live billing and published legal pages remain open. |
| 2026-09-10 | 12.03 — Complete self-service exports | Commit `8b1f249`; activity CSV export now paginates all account activity through a 100,000-row safety cap, preserves formula-safe escaping, and has multi-page API coverage. Report export and Settings download actions are also present. Full validation: 64 test files / 220 tests, typecheck and diff check passed. | Cancellation-access verification and live hosted authorization remain open. |
| 2026-09-10 | 12.04 — Persist deletion plan (partial) | Commit `e674210`; idempotent user deletion requests and cleanup-plan items are persisted through an owned RPC with audit/outbox evidence. Focused deletion tests, typecheck and diff check passed. | Durable executor, auth/storage/account/report/billing cleanup, retries and revoked-access behavior remain open. |
| 2026-09-10 | 03.07 — Robinhood split resolution (partial) | `SPL` rows now infer a ratio from the preceding net position when the result is an unambiguous integer, preserve the corporate-action metadata, and remain blocked when history is insufficient. The persistence migration records validated split actions without creating cash or lot entries; parser coverage includes 3:1, 4:1 and 50:1 cases. A direct regression against the supplied 559-row CSV passed with all 559 rows supported and one each of the 3:1, 4:1 and 50:1 actions. | Local Supabase migration execution and report replay/application still need verification; splits with incomplete history remain blocked. |
| 2026-09-10 | 03.01/10.03 — Unified browser CSV preview parser | The dashboard preview now uses the production Robinhood parser instead of newline/comma splitting, fixing quoted commas, multiline descriptions, BOMs, official footers and split inference in the browser. Added regression coverage for the Robinhood export shape and required-column errors. Full validation: 65 test files / 224 tests, typecheck and production build passed. | Authenticated browser execution against hosted Supabase remains open. |
| 2026-09-10 | 04.05 — Import retry convergence (partial) | Commit `6275c72`; duplicate staging races converge on the existing active import, and commit/undo retries return the already-completed record after a lost response. Repository coverage and typecheck passed. | Cross-database fingerprint canonicalization and full concurrent commit/undo gate remain open. |
| 2026-09-10 | 10.07 — Import review accessibility (partial) | Commit `519cc96`; account form labels, review-table captions/scopes, alert semantics, live validation output and responsive widths were added. Typecheck, public Playwright flows and diff check passed. | Authenticated keyboard focus, screen-reader and 200% enlargement verification remains open. |
| 2026-09-10 | 04.03 — Account mutation serialization (partial) | Commit `4276d5e`; authenticated commit/undo wrappers acquire a transaction-scoped PostgreSQL advisory lock derived from the account UUID, with static migration coverage for delegation and grants. Typecheck and focused tests passed. | Live Supabase migration and concurrent transaction verification remain open. |
| 2026-09-10 | 08.05 — Durable quota reservation ledger (partial) | Commit `5a31998`; service-only reservation/reconciliation contracts and a row-locked monthly quota ledger provide idempotent reserved, consumed and released units. Repository tests and typecheck passed. | At the time of this entry, the daily refresh runner still needed wiring; that was completed by the later integration milestone. Live provider and concurrent database verification remain open. |
| 2026-09-10 | 08.05 — Daily refresh quota integration | Commit `17a953e`; daily refresh now reserves normalized symbols before provider calls, reconciles successful/failed attempts, uses idempotency keys for retries, and maps exhausted reservations to explicit skips. Focused refresh tests and typecheck passed. | Live Supabase/provider execution and the 08.09 end-to-end gate remain open. |
| 2026-09-10 | 06.04 — Persisted opening history | Commit `ffe0c12`; account-owned opening cash, coverage date, explanation and known/unknown lots are validated, persisted through RLS-backed APIs, and editable in the Accounts UI. Focused domain/API tests and typecheck passed. | Live database execution and full report replay from opening history remain open. |
| 2026-09-10 | 09.02 — Snapshot publication dependency integrity | Commit `37433b1`; snapshot retries read back the exact immutable dependency tuple, validate account/report identifiers and dates, and order reader ties deterministically. Four focused repository tests passed. | Live snapshot execution and report queue deployment remain open. |
| 2026-09-10 | 06.06 — Persisted FIFO lot rebuild | Commit `a103071`; account lot rebuild persists FIFO sale matches, validates over-sales, and runs after serialized commit/undo. Two focused migration tests and typecheck passed. | Live Supabase migration execution and end-to-end report reconciliation remain open. |
| 2026-09-10 | 12.04 — Durable deletion executor boundary (partial) | Commit `3c9b956`; ordered cleanup execution covers private files, accounts, reports, billing, profiles and auth through injectable adapters, with durable claim/retry/stale-claim/exhaustion RPCs and focused tests. | Live Auth/Storage/Stripe execution, scheduled deployment and verification of revoked access remain open. |
| 2026-09-10 | 06.08 — Internal transfer reconciliation | Commit `504a2a4`; persisted cash/share transfers resolve through stable ticker aliases, preserve explicit unresolved states, and write account-owned reconciliation results under RLS. Five focused tests and typecheck passed. | Live Supabase migration/execution and end-to-end consolidated report validation remain open. |
| 2026-09-10 | 10.05 — Portfolio detail metrics (partial) | Commit `0efe479`; report/dashboard payloads now expose net deposits, invested value, allocation percentages, explicit incomplete valuation states and FIFO realized-lot detail. Seven focused tests and typecheck passed. | Consolidated snapshots, dividend detail presentation and live authenticated browser verification remain open. |
| 2026-09-10 | 10.05 — Report detail completion | Commits `2c20419` and `b22d167`; snapshots retain individual dividend events, the authenticated dashboard renders dated dividend detail with empty/loading states, and existing period/scope/allocation/lot detail controls are documented as complete. Full Vitest suite (110 files, 403 tests), typecheck and production build passed. | Authenticated browser acceptance remains covered by gate 10.09. |
| 2026-09-10 | 09.08 — Local report pipeline integration | Commit `ef29790` plus `services/reporting/report-pipeline.integration.test.ts`; a committed activity fixture is composed with stored prices, processed by the queue adapter, and published with reconciled value and dividend detail. | Real Supabase/storage upload-to-queue execution and undo/correction reproducibility remain open. |
| 2026-09-10 | 12.06 — Redacted API request logging | Current milestone adds pathname-only structured request logs, injectable logging for tests, and production Worker wiring while preserving rate-limit and body-validation boundaries. Full suite, typecheck and build pass. | Hosted least-privilege role and end-to-end execution-path verification remain open. |
| 2026-09-10 | 09.06 — Consolidated report composition | Commit `01afe90`; consolidated inputs cancel only proven linked internal transfers, preserve external flows/incentives for return calculations, retain unresolved links, and carry incomplete valuation/unknown-basis states. Eight focused tests and typecheck passed. | Live Supabase execution, snapshot publication and end-to-end authenticated verification remain open. |
| 2026-09-10 | 07.05 — Resumable historical seed job | Commit `8b4bb54`; DoltHub seed processing now persists a cursor only after idempotent price/quarantine writes, records symbol mappings and source revisions, and supports bounded restart/retry. Focused tests and typecheck passed. | No bounded live DoltHub/Supabase seed has been executed; licensing and operator review remain open. |
| 2026-09-10 | 11.04 — Durable Stripe webhook handler | Commit `368c349`; verified raw events dispatch through recognized lifecycle handlers, preserve full payloads for replay/audit, resolve ownership from server-controlled customer mappings, and fail unresolved events for retry. Eight focused tests and typecheck passed. | Live Stripe/Supabase execution and staging webhook replay remain open. |
| 2026-09-10 | 05.04/05.06 — Durable import queue and failure evidence | Commit `b77c092`; Cloudflare import jobs now claim and checkpoint processing through service-role RPCs, retry transient failures, persist poison/error evidence before acknowledgment, and expose safe replay primitives. Full validation: 79 test files / 274 tests and typecheck passed. | Live queue binding, Supabase migration execution and deployed import processing remain open. |
| 2026-09-10 | 11.05 — Server-side entitlement enforcement | Commit `c7fe907`; billing access is evaluated at request time for report/freshness endpoints, trial expiry and failed/canceled states are denied, and authenticated billing status is shown in Settings. Focused API/billing tests and typecheck passed. | Live Stripe/Supabase entitlement updates, checkout lifecycle and hosted browser verification remain open. |
| 2026-09-10 | 07.07 — Immutable deterministic price revisions | Commit `cb1a7d9`; same-version price/correction overwrites are rejected by database triggers, source precedence is deterministic, conflicts fail closed, and report snapshots retain selected price dependencies. Full validation: 79 test files / 282 tests and typecheck passed. | Live migration execution and production correction workflow remain open. |
| 2026-09-10 | 02.06 — Auth recovery and session lifecycle | Commit `b4d361a`; password recovery has a dedicated route and validated update, logout revokes globally, account/identity changes clear all private state, and stale session reads are ignored. Full validation: 80 test files / 285 tests and typecheck passed. | Hosted Supabase redirects, email verification and real token revocation remain open. |
| 2026-09-10 | 09.07 — Report methodology and gap disclosure | Commit `6a3718c`; snapshots and dashboard expose chained daily Modified Dietz methodology, midpoint flow timing, no annualization, unavailable non-contiguous periods, explicit gain definitions and not-tax-reporting disclosure. Full validation: 80 test files / 286 tests and typecheck passed. | Live report execution and hosted browser verification remain open. |
| 2026-09-10 | 01.06/13.01 — Static schema security CI gate (partial) | Commit `68d632b`; CI now runs a migration-wide RLS/service-privilege/security-definer audit plus the existing typecheck, unit suite and build. Four security tests passed. | Live RLS guessed-ID/direct-write tests, private Storage execution and authenticated Playwright coverage still require staging infrastructure. |
| 2026-09-10 | 10.06 — Actionable dashboard warning states | Commits `4176951`, `dda6349`, `f5f7274`; authenticated Overview distinguishes missing/stale reports, incomplete history, unavailable prices and no holdings, with direct import, opening-history and retry actions and no synthetic fallback. Full validation: 82 test files / 294 tests and typecheck passed. | Live authenticated browser verification remains open. |
| 2026-09-10 | 13.07 — Operating-cost budget guardrails | Commit `a879f23`; cost assessments use integer cents, current Marketstack allowance assumptions, a 20% retry/import reserve, and explicit target/escalation statuses with documented environment thresholds. Focused tests and typecheck passed. | Actual hosted invoices and production usage remain unverified. |
| 2026-09-10 | 13.04/13.08 — Launch readiness preflight (partial) | Commit `3e6fe6b`; `npm run preflight:launch` now checks required public/server configuration without printing secrets, Supabase URL consistency, bounded Marketstack caps, Worker queue/DLQ and rollback artifacts, and production Stripe/provider-plan requirements. Five focused tests passed. | Hosted deployments, live secrets, migration/RLS/storage checks and full launch evidence remain open. |
| 2026-09-10 | 05.03 — Verified private statement object binding | Commit `1c8f694`; authenticated object-binding verifies account ownership, private Storage access, 10 MB/byte-size limits and SHA-256 before persisting import metadata through an RLS-backed RPC. Focused tests (38) and typecheck passed. | Live Supabase Storage/RLS execution and queued import processing remain open. |
| 2026-09-10 | 09.05 — Report outbox-to-queue wiring (partial) | Commit `ff69ddb`; scheduled transactional outbox dispatch claims report events, publishes typed jobs to `REPORT_QUEUE`, uses `waitUntil` for cron work, and retries safely. Queue tests (9) and typecheck passed. | Durable report input loaders, all import/undo/price-correction triggers, live queue bindings and end-to-end snapshot execution remain open. |
| 2026-09-10 | 10.07 — Workspace accessibility hardening (partial) | Added captions and column scopes to authenticated and synthetic data tables, keyboard Escape dismissal with focus restoration for mobile navigation, a labeled navigation relationship, and a dismissible mobile backdrop. Accessibility contract tests cover table semantics and navigation behavior; focused tests and typecheck passed. | Live authenticated keyboard/screen-reader traversal and 200% enlargement verification remain open. |
| 2026-09-10 | 12.06 — API request boundary hardening (partial) | Added streaming byte caps for JSON/webhook/CSV request bodies, safe malformed JSON handling, stable 413 responses, and a global error boundary that returns only a request ID and generic error. Added API and security regression tests; 43 focused tests and typecheck passed. | Shared production rate-limit storage, complete execution-path audit, redacted runtime log sink, least-privilege deployment verification and live staging checks remain open. |
| 2026-09-10 | 12.07 — Backup and restore drill procedure (partial) | Added `docs/BACKUP_RESTORE_DRILL.md` with proposed 24-hour RPO, 4-hour RTO, isolated Supabase restore steps, ledger/report/price reconciliation invariants, RLS/Storage/Auth checks, and an evidence template. Launch preflight now requires the procedure. | No hosted backup export, isolated restore, measured recovery targets, or alert delivery has been executed yet. |

Earlier implementation history is preserved in [docs/IMPLEMENTATION_HISTORY.md](docs/IMPLEMENTATION_HISTORY.md). Its old checkmarks/limits are historical, not current status. For each future milestone, record stable task IDs, commit, tests and remaining limits here; update counts only for this file's task lines.
