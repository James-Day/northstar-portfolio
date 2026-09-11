# Marketstack development procedure

The scheduled price refresh is opt-in. A Marketstack key by itself cannot
activate the Worker cron. The default checked-in configuration sets
`MARKETSTACK_SCHEDULE_ENABLED=false`, and the Worker also requires a
non-placeholder `MARKETSTACK_API_KEY`, Supabase server credentials, and a valid
positive `MARKETSTACK_MONTHLY_CAP`.

Check the local configuration without printing any secret:

```text
npm run marketstack:dev-status
```

For the free development check, obtain a key from the Marketstack account and
place it only in a local secret store (`.dev.vars` or an equivalent Worker
secret). Confirm the allowance in the provider account UI and record the
account-plan screenshot or ticket reference separately; this repository does
not claim a live allowance or perform that check automatically.

Before enabling the recurring schedule, run one deliberately tiny smoke fetch:

1. Start the local Supabase project and apply migrations.
2. Set `MARKETSTACK_API_KEY` and `MARKETSTACK_MONTHLY_CAP` to values no larger
   than the allowance confirmed in the provider account.
3. Keep `MARKETSTACK_SCHEDULE_ENABLED=false` and invoke the provider from a
   server-side smoke runner for exactly one known symbol and one explicit
   trading date. Use a date with a published close.
4. Persist the normalized close through the daily-price repository, verify the
   stored source is `marketstack`, and record the returned source metadata,
   database revision, symbol, date, and request count.
5. Review the persisted row and quota telemetry. Only then set
   `MARKETSTACK_SCHEDULE_ENABLED=true` for a disposable development Worker.

The smoke fetch is intentionally not part of normal page loads, browser code,
or CI. Never place the key in `NEXT_PUBLIC_*` variables, committed files, or
logs. Do not run this procedure with production credentials, and do not
upgrade or purchase a provider plan as part of MVP development.
