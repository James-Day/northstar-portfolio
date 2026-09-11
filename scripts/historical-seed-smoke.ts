import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['vitest', 'run', 'services/market-data/historical-seed-live-smoke.test.ts', '--reporter=dot'], {
  cwd: process.cwd(),
  env: { ...process.env, DOLTHUB_LIVE_SMOKE: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
