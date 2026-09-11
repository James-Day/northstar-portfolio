import { spawnSync } from 'node:child_process';
import {
  createLocalIntegrationUsers,
  deleteLocalIntegrationUsers,
  parseSupabaseStatusEnv,
  type LocalIntegrationUser,
  type LocalSupabaseCredentials,
} from '../services/platform/local-supabase-fixtures';

const keepRunning = process.argv.includes('--keep');

type Command = { executable: string; prefix: string[] };

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
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`supabase ${args.join(' ')} failed${details ? `: ${details}` : '.'}`);
  }
  if (printOutput && result.stdout) process.stdout.write(result.stdout);
  return result.stdout ?? '';
}

function assertCliAvailable() {
  supabaseCommand();
}

async function main() {
  let started = false;
  let credentials: LocalSupabaseCredentials | undefined;
  let users: LocalIntegrationUser[] = [];
  try {
    assertCliAvailable();
    console.log('Starting isolated local Supabase services…');
    run(['start']);
    started = true;
    console.log('Applying all migrations and deterministic fixtures…');
    run(['db', 'reset']);
    credentials = parseSupabaseStatusEnv(run(['status', '-o', 'env'], false));
    users = await createLocalIntegrationUsers(credentials);
    console.log(`Created ${users.length} deterministic local Auth users in memory for the isolation suite.`);
    console.log('Local database reset and Auth fixtures completed. Start the API/frontend and run the authenticated isolation suite.');
  } finally {
    if (credentials && users.length && !keepRunning) {
      await deleteLocalIntegrationUsers(credentials, users);
      console.log('Removed deterministic local Auth users.');
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
