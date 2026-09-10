import { parseQueueJob, type QueueJob } from './contracts';

export type OutboxRecord = {
  id: string;
  eventType: string;
  payload: unknown;
  attempts: number;
};

export type OutboxRepository = {
  claim(limit: number, now: string): Promise<OutboxRecord[]>;
  complete(id: string): Promise<void>;
  fail(id: string, input: { retryAt: string; error: string; maxAttempts: number }): Promise<'retrying' | 'failed'>;
  resolveAccountOwner(accountId: string): Promise<string | undefined>;
};

export type OutboxJobPublisher = (job: QueueJob, idempotencyKey: string) => Promise<void>;

export type OutboxDispatchResult = {
  claimed: number;
  dispatched: number;
  retried: number;
  failed: number;
  skipped: number;
};

type SupportedPayload = { accountId: string; importId?: string; requestedBy?: string };

function payloadForEvent(event: OutboxRecord): SupportedPayload | undefined {
  if (typeof event.payload !== 'object' || event.payload === null) return undefined;
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.accountId !== 'string' || !payload.accountId.trim()) return undefined;
  return {
    accountId: payload.accountId,
    importId: typeof payload.importId === 'string' ? payload.importId : undefined,
    requestedBy: typeof payload.requestedBy === 'string' ? payload.requestedBy : undefined,
  };
}

function backoff(attempts: number, now: Date): string {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/**
 * Claims transactional outbox rows and translates only known import events to
 * account-owned report jobs. The queue publisher receives a stable outbox key
 * so a provider adapter can deduplicate retries. A row is completed only after
 * publish succeeds; failures remain retryable until maxAttempts is reached.
 */
export async function dispatchOutbox(input: {
  repository: OutboxRepository;
  publish: OutboxJobPublisher;
  limit?: number;
  maxAttempts?: number;
  now?: () => Date;
}): Promise<OutboxDispatchResult> {
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const maxAttempts = Math.max(1, input.maxAttempts ?? 8);
  const now = input.now ?? (() => new Date());
  const claimed = await input.repository.claim(limit, now().toISOString());
  const result: OutboxDispatchResult = { claimed: claimed.length, dispatched: 0, retried: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();

  for (const event of claimed) {
    const finishFailure = async (error: string) => {
      const outcome = await input.repository.fail(event.id, { retryAt: backoff(event.attempts, now()), error, maxAttempts });
      if (outcome === 'failed') result.failed += 1;
      else result.retried += 1;
    };

    if (seen.has(event.id)) {
      result.skipped += 1;
      continue;
    }
    seen.add(event.id);
    const payload = payloadForEvent(event);
    const reason = event.eventType === 'import.committed' ? 'import_committed' : event.eventType === 'import.undone' ? 'import_undone' : undefined;
    if (!payload || !reason) {
      await finishFailure(`Unsupported outbox event: ${event.eventType}.`);
      continue;
    }
    const requestedBy = await input.repository.resolveAccountOwner(payload.accountId);
    if (!requestedBy || (payload.requestedBy && payload.requestedBy !== requestedBy)) {
      await finishFailure('Outbox account ownership could not be verified.');
      continue;
    }
    const job = parseQueueJob({ kind: 'report.recompute', accountId: payload.accountId, requestedBy, reason });
    try {
      await input.publish(job, `job-outbox:${event.id}`);
      await input.repository.complete(event.id);
      result.dispatched += 1;
    } catch (error) {
      await finishFailure(error instanceof Error ? error.message : 'Queue publication failed.');
    }
  }
  return result;
}
