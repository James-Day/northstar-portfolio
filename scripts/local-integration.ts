import { spawnSync } from 'node:child_process';

const keepRunning = process.argv.includes('--keep');

function run(args: string[]): string {
  const result = spawnSync('supabase', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  if (result.error?.message.includes('ENOENT')) throw new Error('Supabase CLI is required. Install it, then run this harness again.');
  if (result.status !== 0) throw new Error(`supabase ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : '.'}`);
  if (result.stdout) process.stdout.write(result.stdout);
  return result.stdout ?? '';
}

function assertCliAvailable() {
  const result = spawnSync('supabase', ['--version'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error?.message.includes('ENOENT')) throw new Error('Supabase CLI is required. Install it, then run this harness again.');
  if (result.status !== 0) throw new Error(`Supabase CLI preflight failed${result.stderr ? `: ${result.stderr.trim()}` : '.'}`);
}

let started = false;
try {
  assertCliAvailable();
  console.log('Starting isolated local Supabase services…');
  run(['start']);
  started = true;
  console.log('Applying all migrations and deterministic fixtures…');
  run(['db', 'reset']);
  console.log('Local database reset completed. Create two users through the local Auth API and run the authenticated isolation suite.');
} finally {
  if (!keepRunning && started) {
    console.log('Stopping local Supabase services…');
    const stop = spawnSync('supabase', ['stop', '--no-backup'], { cwd: process.cwd(), stdio: 'inherit' });
    if (stop.status !== 0) process.exitCode = stop.status ?? 1;
  } else if (keepRunning && started) {
    console.log('Keeping local Supabase services running (--keep).');
  }
}
