import { readFile } from 'node:fs/promises';
import { validateBackupRestoreEvidence } from '../services/platform/backup-restore-evidence.ts';

const file = process.argv[2];
if (!file || file.startsWith('-')) {
  console.error('Usage: npm run backup:verify -- path/to/backup-restore-evidence.json');
  process.exitCode = 2;
} else {
  try {
    const evidence = JSON.parse(await readFile(file, 'utf8')) as unknown;
    const result = validateBackupRestoreEvidence(evidence);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
