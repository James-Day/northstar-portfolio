import type { QueueHandlers } from './consumer';
import type { QueueJob } from './contracts';

export type ImportProcessingLease = { importId: string; accountId: string; attempt: number; totalRows: number; progressRows: number };

export type ImportJobRepository = {
  claim(job: Extract<QueueJob, { kind: 'import.process' }>): Promise<ImportProcessingLease | { state: 'already_complete' } | undefined>;
  progress(lease: ImportProcessingLease, progressRows: number): Promise<void>;
  complete(lease: ImportProcessingLease): Promise<void>;
  fail(lease: ImportProcessingLease, error: string): Promise<'retrying' | 'dead_lettered'>;
};

/** Advances durable import checkpoints; the repository owns atomic lease semantics. */
export function createImportQueueHandlers(repository: ImportJobRepository, input: { checkpointEvery?: number } = {}): Pick<QueueHandlers, 'importProcess'> {
  const configuredCheckpointEvery = input.checkpointEvery ?? 500;
  if (!Number.isFinite(configuredCheckpointEvery) || configuredCheckpointEvery < 1)
    throw new Error('Import checkpoint interval must be a finite positive number.');
  const checkpointEvery = Math.max(1, Math.floor(configuredCheckpointEvery));
  return {
    importProcess: async (job) => {
      const lease = await repository.claim(job);
      if (!lease || 'state' in lease) return;
      try {
        validateLease(lease);
        const start = lease.progressRows;
        if (lease.totalRows === 0) await repository.progress(lease, 0);
        else {
          for (let row = start + checkpointEvery; row < lease.totalRows; row += checkpointEvery) await repository.progress(lease, row);
          await repository.progress(lease, lease.totalRows);
        }
        await repository.complete(lease);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import processing failed.';
        const outcome = await repository.fail(lease, message);
        if (outcome === 'retrying') throw error;
      }
    },
  };
}

function validateLease(lease: ImportProcessingLease): void {
  if (!Number.isInteger(lease.totalRows) || lease.totalRows < 0)
    throw new Error('Import lease total row count is invalid.');
  if (!Number.isInteger(lease.progressRows) || lease.progressRows < 0 || lease.progressRows > lease.totalRows)
    throw new Error('Import lease progress is outside the total row range.');
  if (!Number.isInteger(lease.attempt) || lease.attempt < 1)
    throw new Error('Import lease attempt is invalid.');
}
