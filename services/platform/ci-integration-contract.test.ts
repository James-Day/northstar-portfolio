import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/checks.yml'), 'utf8');

describe('authenticated CI integration contract', () => {
  it('keeps the live integration job isolated and repeatable', () => {
    expect(workflow).toMatch(/integration:\s*\n\s+name: Supabase and authenticated browser integration/);
    expect(workflow).toMatch(/runs-on:\s+ubuntu-latest/);
    expect(workflow).toMatch(/npx --yes supabase start/);
    expect(workflow).toMatch(/npx --yes supabase db reset/);
    expect(workflow).toMatch(/npx --yes supabase status -o env/);
    expect(workflow).toMatch(/trap cleanup EXIT/);
    expect(workflow).toMatch(/supabase stop --no-backup/);
    expect(workflow).toMatch(/npm run dev:api -- --ip 127\.0\.0\.1 --port 8787/);
    expect(workflow).toMatch(/curl --fail --silent http:\/\/127\.0\.0\.1:8787\/health/);
  });

  it('creates a disposable auth fixture and exercises the authenticated browser path', () => {
    expect(workflow).toMatch(/\/auth\/v1\/signup/);
    expect(workflow).toMatch(/portfolio-integration-a@example\.test/);
    expect(workflow).toMatch(/portfolio-integration-b@example\.test/);
    expect(workflow).toMatch(/storage\/v1\/object\/brokerage-statements/);
    expect(workflow).toMatch(/cross_user_status=/);
    expect(workflow).toMatch(/cross_user_status="\$\(curl[\s\S]*?if \[\[ "\$\{cross_user_status\}" != '400'/);
    expect(workflow).toMatch(/Private Storage isolation returned an unexpected HTTP status/);
    expect(workflow).toMatch(/-X DELETE/);
    expect(workflow).toMatch(/E2E_AUTH_EMAIL=/);
    expect(workflow).toMatch(/E2E_AUTH_PASSWORD=/);
    expect(workflow).toMatch(/npm run test:e2e -- tests\/e2e\/authenticated-workspace\.spec\.ts/);
    expect(workflow).toMatch(/kill "\$\{app_pid\}"/);
    expect(workflow).toMatch(/wait "\$\{app_pid\}"/);
    expect(workflow).toMatch(/rm -f "\$\{RUNNER_TEMP\}\/auth-a\.json" "\$\{RUNNER_TEMP\}\/auth-b\.json" "\$\{RUNNER_TEMP\}\/statement\.csv"/);
    expect(workflow).toMatch(/kill "\$\{api_pid\}"/);
    expect(workflow).toMatch(/wait "\$\{api_pid\}"/);
  });

  it('passes only ephemeral public configuration to the app and redacts diagnostics', () => {
    expect(workflow).toMatch(/export NEXT_PUBLIC_SUPABASE_URL="\$\{API_URL\}"/);
    expect(workflow).toMatch(/export NEXT_PUBLIC_SUPABASE_ANON_KEY="\$\{ANON_KEY\}"/);
    expect(workflow).toMatch(/export SUPABASE_SERVICE_ROLE_KEY="\$\{SERVICE_ROLE_KEY\}"/);
    expect(workflow).toMatch(/export NEXT_PUBLIC_API_URL="http:\/\/127\.0\.0\.1:8787"/);
    expect(workflow).toMatch(/unset SERVICE_ROLE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL SUPABASE_ANON_KEY POSTGRES_PASSWORD DASHBOARD_PASSWORD JWT_SECRET/);
    expect(workflow).not.toMatch(/unset SERVICE_ROLE_KEY POSTGRES_PASSWORD DASHBOARD_PASSWORD JWT_SECRET\n\n          npm run dev/);
    expect(workflow).toMatch(/safe_tail/);
    expect(workflow).toMatch(/REDACTED_TOKEN/);
    expect(workflow).toMatch(/ACCESS_TOKEN\|REFRESH_TOKEN\|PASSWORD/);
    expect(workflow).toMatch(/\(ANON\|SERVICE_ROLE\|JWT_SECRET\|POSTGRES_PASSWORD\|DASHBOARD_PASSWORD\|ACCESS_TOKEN\|REFRESH_TOKEN\|PASSWORD\)/);
    expect(workflow).not.toMatch(/export NEXT_PUBLIC_\w*(SERVICE_ROLE|PASSWORD|JWT_SECRET)/);
  });
});
