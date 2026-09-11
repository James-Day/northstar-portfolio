import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scanBrowserOutput } from './browser-secret-scan.ts';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // Windows exposes npm as a .cmd shim, which requires shell dispatch.
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`,
          ),
        );
    });
  });
}

async function main(): Promise<void> {
  console.log('Baseline gate: typecheck');
  await run(npmCommand, ['run', 'typecheck']);
  console.log('Baseline gate: Vitest');
  await run(npmCommand, ['test']);
  console.log('Baseline gate: production build');
  await run(npmCommand, ['run', 'build']);

  const browserRoot = resolve(root, 'dist', 'client');
  await access(browserRoot);
  const configuredSecrets = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.STRIPE_SECRET_KEY,
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.MARKETSTACK_API_KEY,
  ].filter((value): value is string => Boolean(value));
  const findings = await scanBrowserOutput(browserRoot, configuredSecrets);
  if (findings.length > 0) {
    const summary = findings
      .map(({ file, rule }) => `${file}: ${rule}`)
      .join(', ');
    throw new Error(
      `Generated browser output contains server/provider secret material (${summary}).`,
    );
  }
  console.log(
    'Baseline gate: generated browser output contains no detected server/provider secrets.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
