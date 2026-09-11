import { describe, expect, it } from 'vitest';
import { handleScheduledRetention } from '@/workers/scheduled-retention';
import { type RetentionCandidate, runRawFileRetention } from '@/services/privacy/retention-executor';

type Row = RetentionCandidate & { status: 'pending' | 'deleting' | 'deleted' | 'exhausted'; availableAt: Date; claimedAt: Date | null; lastError: string | null };

function fixture(now: Date): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    importId: '22222222-2222-4222-8222-222222222222',
    objectPath: 'user/account/statement.csv',
    uploadedAt: new Date(now.getTime() - 30 * 86_400_000),
    deletedAt: null,
    attempt: 0,
    status: 'pending',
    availableAt: now,
    claimedAt: null,
    lastError: null,
  };
}

function repository(row: Row, audit: Array<{ event: string; attempt: number; error?: string }>) {
  return {
    async claim(now: Date, limit: number, maxAttempts: number) {
      if (limit < 1 || row.attempt >= maxAttempts || row.status === 'deleted' || row.status === 'exhausted') return [];
      const eligible = row.status === 'pending' && row.availableAt <= now && row.uploadedAt <= new Date(now.getTime() - 30 * 86_400_000);
      const recoverable = row.status === 'deleting' && row.claimedAt !== null && row.claimedAt <= new Date(now.getTime() - 15 * 60_000);
      if (!eligible && !recoverable) return [];
      row.status = 'deleting';
      row.attempt += 1;
      row.claimedAt = now;
      audit.push({ event: 'claimed', attempt: row.attempt });
      return [row];
    },
    async markDeleted(_id: string, at: Date) {
      row.status = 'deleted';
      row.deletedAt = at;
      row.claimedAt = null;
      audit.push({ event: 'deleted', attempt: row.attempt });
    },
    async markFailure(_id: string, input: { at: Date; retryAt: Date; error: string; maxAttempts: number }) {
      row.lastError = input.error;
      row.claimedAt = null;
      if (row.attempt >= input.maxAttempts) {
        row.status = 'exhausted';
        audit.push({ event: 'exhausted', attempt: row.attempt, error: input.error });
        return 'exhausted' as const;
      }
      row.status = 'pending';
      row.availableAt = input.retryAt;
      audit.push({ event: 'failed', attempt: row.attempt, error: input.error });
      return 'retrying' as const;
    },
  };
}

describe('scheduled retention local composition', () => {
  it('claims, retries, verifies deletion, and preserves normalized activity', async () => {
    const scheduledAt = new Date('2026-02-01T00:00:00.000Z');
    const row = fixture(scheduledAt);
    const audit: Array<{ event: string; attempt: number; error?: string }> = [];
    const repositoryAdapter = repository(row, audit);
    const normalizedActivity = [{ importId: row.importId, type: 'buy', symbol: 'VOO', amount: '100.00' }];
    let failOnce = true;
    const storage = {
      objects: new Set([row.objectPath]),
      async delete(path: string) {
        if (failOnce) {
          failOnce = false;
          throw new Error('temporary storage outage');
        }
        this.objects.delete(path);
      },
      async verifyDeleted(path: string) { return !this.objects.has(path); },
    };

    let scheduledPromise: Promise<unknown> | undefined;
    handleScheduledRetention(
      { scheduledTime: scheduledAt.getTime() },
      { waitUntil: (promise) => { scheduledPromise = promise; } },
      { repository: repositoryAdapter, storage },
    );
    await scheduledPromise;
    expect(row.status).toBe('pending');
    expect(audit.map((event) => event.event)).toEqual(['claimed', 'failed']);
    expect(storage.objects.has(row.objectPath)).toBe(true);

    const retryAt = row.availableAt;
    const result = await runRawFileRetention({ repository: repositoryAdapter, storage, now: () => retryAt, retryDelayMs: 1 });
    expect(result).toEqual({ claimed: 1, deleted: 1, retrying: 0, exhausted: 0 });
    expect(row.status).toBe('deleted');
    expect(storage.objects.has(row.objectPath)).toBe(false);
    expect(audit.map((event) => event.event)).toEqual(['claimed', 'failed', 'claimed', 'deleted']);
    expect(normalizedActivity).toEqual([{ importId: row.importId, type: 'buy', symbol: 'VOO', amount: '100.00' }]);
  });
});
