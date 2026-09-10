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
  const checkpointEvery = Math.max(1, Math.floor(input.checkpointEvery ?? 500));
  return {
    importProcess: async (job) => {
      const lease = await repository.claim(job);
      if (!lease || 'state' in lease) return;
      try {
        const start = Math.max(lease.progressRows, 0);
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
