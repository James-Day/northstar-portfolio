import { describe, expect, it, vi } from 'vitest';
import { consumeQueueMessages, type QueueMessage } from '@/services/queues/consumer';
import { createImportQueueHandlers, type ImportProcessingLease, type ImportJobRepository } from '@/services/queues/import-worker';

type StoredObject = { ownerId: string; bytes: Uint8Array };

/** Small local model of the private bucket contract used by the real adapter. */
function privateObjects() {
  const objects = new Map<string, StoredObject>();
  return {
    put(path: string, ownerId: string, bytes: Uint8Array) {
      if (!path.startsWith(`${ownerId}/`)) throw new Error('object path is outside the owner prefix');
      objects.set(path, { ownerId, bytes });
    },
    read(path: string, requesterId: string) {
      const object = objects.get(path);
      if (!object || object.ownerId !== requesterId) throw new Error('private object is unavailable');
      return object.bytes;
    },
    has(path: string) { return objects.has(path); },
  };
}

function queueMessage(body: unknown): QueueMessage {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('private storage and queued import acceptance boundary', () => {
  it('keeps uploaded objects isolated by owner and preserves the object after a failed delivery', async () => {
    const storage = privateObjects();
    const path = 'user-a/account-a/statement.csv';
    const bytes = new TextEncoder().encode('Date,Amount\n2026-01-02,100.00\n');
    storage.put(path, 'user-a', bytes);
    expect(storage.read(path, 'user-a')).toEqual(bytes);
    expect(() => storage.read(path, 'user-b')).toThrow('private object is unavailable');
    expect(storage.has(path)).toBe(true);

    const evidence: Array<{ reason: string; payload: unknown }> = [];
    let firstRead = true;
    const state = { progressRows: 0, attempts: 0, completed: 0 };
    const repository: ImportJobRepository = {
      claim: vi.fn(async (): Promise<ImportProcessingLease | { state: 'already_complete' } | undefined> => {
        if (state.completed > 0) return { state: 'already_complete' };
        state.attempts += 1;
        return { importId: 'import-a', accountId: 'account-a', attempt: state.attempts, totalRows: 3, progressRows: state.progressRows };
      }),
      progress: vi.fn(async (_lease, progressRows) => {
        if (firstRead) {
          firstRead = false;
          throw new Error('temporary private object read failure');
        }
        state.progressRows = progressRows;
      }),
      complete: vi.fn(async () => { state.completed += 1; }),
      fail: vi.fn(async (_lease, error) => {
        evidence.push({ reason: error, payload: { importId: 'import-a' } });
        return 'retrying' as const;
      }),
    };
    const handler = createImportQueueHandlers(repository, { checkpointEvery: 2 });
    const job = { kind: 'import.process' as const, importId: 'import-a', accountId: 'account-a', requestedBy: 'user-a' };
    const first = queueMessage(job);
    await expect(consumeQueueMessages([first], { importProcess: handler.importProcess })).resolves.toEqual({ acknowledged: 0, retried: 1, rejected: 0 });
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(evidence).toHaveLength(1);
    expect(storage.has(path)).toBe(true);

    const second = queueMessage(job);
    await expect(consumeQueueMessages([second], { importProcess: handler.importProcess })).resolves.toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(state.progressRows).toBe(3);
    expect(state.completed).toBe(1);
    expect(second.ack).toHaveBeenCalledOnce();

    const duplicate = queueMessage(job);
    await expect(consumeQueueMessages([duplicate], { importProcess: handler.importProcess })).resolves.toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(state.completed).toBe(1);
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it('retries when failure evidence cannot be persisted instead of acknowledging a lost job', async () => {
    const message = queueMessage({ kind: 'import.process', importId: 'import-b', accountId: 'account-b', requestedBy: 'user-b' });
    const recorder = { record: vi.fn().mockRejectedValue(new Error('evidence store unavailable')) };
    const handler = vi.fn().mockRejectedValue(new Error('malformed source row'));
    await expect(consumeQueueMessages([message], { importProcess: handler }, { failureRecorder: recorder, queueName: 'imports' })).resolves.toEqual({ acknowledged: 0, retried: 1, rejected: 0 });
    expect(recorder.record).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });
});
