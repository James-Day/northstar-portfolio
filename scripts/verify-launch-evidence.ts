import { readFile } from 'node:fs/promises';
import { aggregateLaunchEvidence } from '../services/platform/launch-evidence.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run launch:evidence -- path/to/launch-evidence.json');
  process.exitCode = 2;
} else {
  const evidence = JSON.parse(await readFile(file, 'utf8')) as Parameters<typeof aggregateLaunchEvidence>[0];
  const result = aggregateLaunchEvidence(evidence);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}
