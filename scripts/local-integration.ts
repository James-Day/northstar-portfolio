import { spawnSync } from 'node:child_process';

const keepRunning = process.argv.includes('--keep');

function run(args: string[]): string {
  const result = spawnSync('supabase', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  if (result.error?.message.includes('ENOENT')) throw new Error('Supabase CLI is required. Install it, then run this harness again.');
  if (result.status !== 0) throw new Error(`supabase ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : '.'}`);
  if (result.stdout) process.stdout.write(result.stdout);
  return result.stdout ?? '';
}

try {
  console.log('Starting isolated local Supabase services…');
  run(['start']);
  console.log('Applying all migrations and deterministic fixtures…');
  run(['db', 'reset']);
  console.log('Local database reset completed. Create two users through the local Auth API and run the authenticated isolation suite.');
} finally {
  if (!keepRunning) {
    console.log('Stopping local Supabase services…');
    const stop = spawnSync('supabase', ['stop', '--no-backup'], { cwd: process.cwd(), stdio: 'inherit' });
    if (stop.status !== 0) process.exitCode = stop.status ?? 1;
  } else {
    console.log('Keeping local Supabase services running (--keep).');
  }
}
