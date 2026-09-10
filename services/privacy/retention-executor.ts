import type { RawFileRecord } from '@/services/privacy/retention';

export type RetentionCandidate = RawFileRecord & {
  id: string;
  attempt: number;
};

export type RetentionClaimRepository = {
  claim(now: Date, limit: number, maxAttempts: number): Promise<RetentionCandidate[]>;
  markDeleted(id: string, at: Date): Promise<void>;
  markFailure(id: string, input: { at: Date; retryAt: Date; error: string; maxAttempts: number }): Promise<'retrying' | 'exhausted'>;
};

/** The storage adapter is deliberately tiny so deletion can be tested without Supabase. */
export type PrivateObjectStore = {
  delete(path: string): Promise<void>;
  verifyDeleted(path: string): Promise<boolean>;
};

export type RetentionRunResult = {
  claimed: number;
  deleted: number;
  retrying: number;
  exhausted: number;
};

export type RetentionRunOptions = {
  repository: RetentionClaimRepository;
  storage: PrivateObjectStore;
  now?: () => Date;
  limit?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error('Retention limits must be positive integers.');
  return Math.min(value, maximum);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/(authorization|token|secret|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1000);
}

/**
 * Processes a bounded batch of private statement objects. Claiming, audit rows,
 * retry timing, and attempt limits are persisted by the injected repository.
 * A successful delete is verified before the import is marked deleted.
 */
export async function runRawFileRetention(options: RetentionRunOptions): Promise<RetentionRunResult> {
  const now = options.now ?? (() => new Date());
  const at = now();
  const limit = boundedInteger(options.limit, 100, 500);
  const maxAttempts = boundedInteger(options.maxAttempts, 8, 50);
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) throw new Error('Retention retry delay must be a non-negative integer.');

  const candidates = await options.repository.claim(at, limit, maxAttempts);
  const result: RetentionRunResult = { claimed: candidates.length, deleted: 0, retrying: 0, exhausted: 0 };
  for (const candidate of candidates) {
    try {
      await options.storage.delete(candidate.objectPath);
      if (!await options.storage.verifyDeleted(candidate.objectPath)) throw new Error('Private object still exists after deletion.');
      await options.repository.markDeleted(candidate.id, at);
      result.deleted += 1;
    } catch (error) {
      const outcome = await options.repository.markFailure(candidate.id, {
        at,
        retryAt: new Date(at.getTime() + retryDelayMs),
        error: errorMessage(error),
        maxAttempts,
      });
      if (outcome === 'exhausted') result.exhausted += 1;
      else result.retrying += 1;
    }
  }
  return result;
}
