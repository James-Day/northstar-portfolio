# Verification baseline

Run this from a clean working tree after installing dependencies:

```text
npm ci
npm run baseline:gate
npm run test:security
npm run test:e2e:install
npm run test:e2e
```

`baseline:gate` runs the TypeScript typecheck, the complete Vitest suite, and a
production build. It then scans text assets under `dist/client` for provider
credential formats, server-only credential names, private-key material, and
configured server secret values. Findings report only the generated file and a
rule name; matching content and secret values are never printed.

This gate proves repository-side compilation, unit-test, build, and generated
browser-output properties. It does not prove a fresh checkout's migration or
database-isolation execution, hosted deployment, or live provider behavior.
Those require the local integration harness and target services to be
available, followed by the database and browser acceptance gates.

