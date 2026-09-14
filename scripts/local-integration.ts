import { spawnSync } from 'node:child_process';
import {
  createLocalIntegrationUsers,
  deleteLocalIntegrationUsers,
  seedLocalIntegrationReferenceData,
  LocalIntegrationUsersError,
  parseSupabaseStatusEnv,
  type LocalIntegrationUser,
  type LocalSupabaseCredentials,
} from '../services/platform/local-supabase-fixtures.ts';
import { boundedRedactedOutput, startLocalProcess, stopLocalProcesses, waitForLocalHttp, type LocalProcessHandle } from './local-processes.ts';
import { runLocalRlsAcceptance } from '../services/platform/local-rls-acceptance.ts';
import { runLocalImportAcceptance } from '../services/platform/local-import-acceptance.ts';
import { readFile } from 'node:fs/promises';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const keepRunning = process.argv.includes('--keep');
const withApp = process.argv.includes('--with-app');
const withRls = process.argv.includes('--rls');
const withBrowser = process.argv.includes('--browser');
const withImport = process.argv.includes('--import');
const withImportAll = process.argv.includes('--import-all');

type Command = { executable: string; prefix: string[] };

function createLocalFrontendVars(credentials: LocalSupabaseCredentials): { cleanup: () => void } {
  const path = join(process.cwd(), '.dev.vars.integration');
  if (existsSync(path)) throw new Error('A previous local integration run left .dev.vars.integration; remove it before retrying.');
  writeFileSync(path, [
    `SUPABASE_URL=${credentials.apiUrl}`,
    `SUPABASE_ANON_KEY=${credentials.anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${credentials.serviceRoleKey}`,
    `NEXT_PUBLIC_SUPABASE_URL=${credentials.apiUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${credentials.anonKey}`,
    'NEXT_PUBLIC_API_URL=http://127.0.0.1:8787',
  ].join('\n') + '\n', 'utf8');
  return { cleanup: () => { if (existsSync(path)) unlinkSync(path); } };
}

function supabaseCommand(): Command {
  const directExecutable = process.platform === 'win32' ? 'supabase.cmd' : 'supabase';
  const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const shell = process.platform === 'win32';
  const direct = spawnSync(directExecutable, ['--version'], { cwd: process.cwd(), encoding: 'utf8', shell });
  if (!direct.error && direct.status === 0) return { executable: directExecutable, prefix: [] };
  const npx = spawnSync(npxExecutable, ['--yes', 'supabase', '--version'], { cwd: process.cwd(), encoding: 'utf8', shell });
  if (!npx.error && npx.status === 0) return { executable: npxExecutable, prefix: ['--yes', 'supabase'] };
  throw new Error('Supabase CLI is required. Install it or ensure `npx supabase` is available, then run this harness again.');
}

function run(args: string[], printOutput = true): string {
  const command = supabaseCommand();
  const result = spawnSync(command.executable, [...command.prefix, ...args], { cwd: process.cwd(), encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  if (result.status !== 0) {
    const details = boundedRedactedOutput([result.stderr, result.stdout].filter(Boolean).join('\n'));
    throw new Error(`supabase ${args.join(' ')} failed${details ? `: ${details}` : '.'}`);
  }
  if (printOutput && result.stdout) process.stdout.write(result.stdout);
  return result.stdout ?? '';
}

function assertCliAvailable() {
  supabaseCommand();
}

async function startApps(credentials: LocalSupabaseCredentials, browser = false): Promise<LocalProcessHandle[]> {
  const apiPort = 8787;
  const frontendPort = 3000;
  if (browser && process.platform === 'win32') {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', '$p=(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if ($p) { Stop-Process -Id $p -Force }'], { windowsHide: true, stdio: 'ignore' });
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    SUPABASE_URL: credentials.apiUrl,
    SUPABASE_ANON_KEY: credentials.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: credentials.serviceRoleKey,
    ...(browser ? {
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
      NEXT_PUBLIC_SUPABASE_URL: credentials.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.anonKey,
    } : {}),
  };
  const specs = [
    // Use the HTTP-only local config here. Deployment bindings remain in
    // wrangler.api.toml and are exercised by the staging/launch contracts;
    // Wrangler's Windows local queue/DO runtime is not needed for this smoke.
    { name: 'api', command: 'npx', args: [
      'wrangler', 'dev', '--config', 'wrangler.api.local.toml',
      '--var', `SUPABASE_URL:${credentials.apiUrl}`,
      '--var', `SUPABASE_ANON_KEY:${credentials.anonKey}`,
      '--var', `SUPABASE_SERVICE_ROLE_KEY:${credentials.serviceRoleKey}`,
      ...(browser ? ['--port', String(apiPort)] : []),
    ], url: `http://127.0.0.1:${apiPort}/health` },
    { name: 'frontend', command: 'npm', args: ['run', 'dev', '--', '--host', '127.0.0.1', ...(browser ? ['--port', String(frontendPort)] : [])], url: `http://localhost:${frontendPort}/` },
  ];
  const handles: LocalProcessHandle[] = [];
  for (const spec of specs) {
    try {
      const probeUrl = spec.name === 'frontend' ? 'http://localhost:3000/' : spec.url;
      const response = await fetch(probeUrl);
      if (response.status < 500 && !browser) {
        console.log(`${spec.name} already available; reusing the existing process.`);
        continue;
      }
    } catch {
      // Start the process below when no listener is available.
    }
    handles.push(startLocalProcess(spec, {
      env: spec.name === 'frontend'
        ? { ...env, CLOUDFLARE_ENV: 'integration', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' }
        : env,
      output: (line) => process.stdout.write(`${line}\n`),
    }));
  }
  return handles;
}

async function waitForInterrupt(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => { process.off('SIGINT', done); process.off('SIGTERM', done); resolve(); };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

async function waitForSupabaseReady(attempts = 60, delayMs = 2000): Promise<string> {
  let lastError = 'unknown readiness error';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return run(['status', '-o', 'env'], false);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Local Supabase did not become ready: ${lastError}`);
}

async function waitForSupabaseAuthReady(
  credentials: Pick<LocalSupabaseCredentials, 'apiUrl' | 'anonKey'>,
  attempts = 60,
  delayMs = 1000,
): Promise<void> {
  let lastError = 'no response';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${credentials.apiUrl.replace(/\/$/, '')}/auth/v1/settings`, {
        headers: { apikey: credentials.anonKey },
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Local Supabase Auth did not become ready (${lastError}).`);
}

async function main() {
  let started = false;
  let credentials: LocalSupabaseCredentials | undefined;
  let users: LocalIntegrationUser[] = [];
  let apps: LocalProcessHandle[] = [];
  let frontendVars: { cleanup: () => void } | undefined;
  try {
    assertCliAvailable();
    console.log('Starting isolated local Supabase services…');
    // Supabase start prints a JSON block containing local credentials. Keep
    // that output out of the terminal; status credentials are consumed only
    // in memory below.
    run(['start'], false);
    console.log('Local Supabase services started.');
    started = true;
    console.log('Waiting for the local database to become ready…');
    const statusEnv = await waitForSupabaseReady();
    console.log('Applying all migrations and deterministic fixtures…');
    run(['db', 'reset']);
    credentials = parseSupabaseStatusEnv(statusEnv);
    await waitForSupabaseAuthReady(credentials);
    try {
      users = await createLocalIntegrationUsers(credentials);
      await seedLocalIntegrationReferenceData(credentials);
    } catch (error) {
      if (error instanceof LocalIntegrationUsersError) users = error.createdUsers;
      throw error;
    }
    console.log(`Created ${users.length} deterministic local Auth users in memory for the isolation suite.`);
    if (withRls) {
      if (users.length !== 2) throw new Error('The RLS acceptance suite requires both deterministic Auth users.');
      await runLocalRlsAcceptance(credentials, [users[0], users[1]]);
    }
    if (withApp || withBrowser || withImport || withImportAll) {
      frontendVars = createLocalFrontendVars(credentials);
      console.log('Starting API and frontend processes…');
      apps = await startApps(credentials, withBrowser);
      await Promise.all(apps.map((app) => waitForLocalHttp(app, fetch, withBrowser ? { attempts: 60, delayMs: 500 } : undefined)));
      if (withImport || withImportAll) {
        const importCases = withImportAll
          ? [
            { fileName: 'individual-activity.csv', accountType: 'individual' as const, accountName: 'Local individual import smoke', verifyPersistedProjections: true, expectedLedgerCash: '415.98' },
            { fileName: 'traditional-ira-activity.csv', accountType: 'traditional_ira' as const, accountName: 'Local Traditional IRA import smoke', verifyPersistedProjections: true, expectedLedgerCash: '698.47' },
            { fileName: 'roth-ira-activity.csv', accountType: 'roth_ira' as const, accountName: 'Local Roth IRA import smoke', verifyPersistedProjections: true, expectedLedgerCash: '712.75' },
          ]
          : [{ fileName: 'individual-activity.csv', accountType: 'individual' as const, accountName: 'Local individual import smoke' }];
        for (const importCase of importCases) {
          const csv = await readFile(new URL(`../fixtures/robinhood/${importCase.fileName}`, import.meta.url), 'utf8');
          await runLocalImportAcceptance('http://127.0.0.1:8787', users[0], csv, fetch, {
            supabaseUrl: credentials.apiUrl,
            serviceRoleKey: credentials.serviceRoleKey,
            userId: users[0].userId,
          }, importCase);
        }
        console.log(`Local authenticated Robinhood staging/review/commit/undo acceptance passed for ${importCases.length} account type(s).`);
      }
      if (withBrowser) {
        const sessionProbe = await fetch('http://localhost:3000/api/auth/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessToken: users[0]?.accessToken }),
        });
        console.log(`Local browser session endpoint preflight: HTTP ${sessionProbe.status}.`);
        const browserEnv: NodeJS.ProcessEnv = {
          ...process.env,
          E2E_AUTH_EMAIL: users[0]?.email,
          E2E_AUTH_PASSWORD: users[0]?.password,
          E2E_AUTH_EMAIL_B: users[1]?.email,
          E2E_AUTH_PASSWORD_B: users[1]?.password,
          PLAYWRIGHT_BASE_URL: 'http://localhost:3000',
          PLAYWRIGHT_EXTERNAL_SERVER: '1',
        };
        const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const browserRun = spawnSync(command, ['--yes', 'playwright', 'test', 'tests/e2e/authenticated-workspace.spec.ts', '--reporter=line'], {
          cwd: process.cwd(),
          env: browserEnv,
          stdio: 'inherit',
          shell: process.platform === 'win32',
          windowsHide: true,
        });
        if (browserRun.status !== 0) throw new Error(`Authenticated browser acceptance failed with exit code ${browserRun.status ?? 'unknown'}.`);
        console.log('Authenticated browser acceptance passed.');
      } else {
        console.log('API and frontend are ready. Run the authenticated isolation suite.');
      }
      if (keepRunning) await waitForInterrupt();
    } else {
      console.log('Local database reset and Auth fixtures completed. Use --with-app to start the API/frontend smoke harness.');
    }
  } finally {
    if (!keepRunning) await stopLocalProcesses(apps);
    frontendVars?.cleanup();
    if (credentials && users.length && !keepRunning) {
      try {
        await deleteLocalIntegrationUsers(credentials, users);
        console.log('Removed deterministic local Auth users.');
      } catch (cleanupError) {
        // Preserve the primary acceptance failure; cleanup diagnostics should
        // not hide the assertion that tells an operator what failed.
        console.error(cleanupError instanceof Error ? cleanupError.message : 'Local Auth fixture cleanup failed.');
      }
    }
    if (!keepRunning && started) {
      console.log('Stopping local Supabase services…');
      const command = supabaseCommand();
      const stop = spawnSync(command.executable, [...command.prefix, 'stop', '--no-backup'], { cwd: process.cwd(), stdio: 'inherit', shell: process.platform === 'win32' });
      if (stop.status !== 0) process.exitCode = stop.status ?? 1;
    } else if (keepRunning && started) {
      console.log('Keeping local Supabase services running (--keep); Auth fixture users are retained for this session.');
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local integration harness failed.');
  process.exitCode = 1;
});
