import { describe, expect, it, vi } from 'vitest';
import { createImportQueueHandlers, type ImportJobRepository } from './import-worker';

function repo(overrides: Partial<ImportJobRepository> = {}): ImportJobRepository {
  return {
    claim: vi.fn().mockResolvedValue({ importId: 'import-1', accountId: 'account-1', attempt: 1, totalRows: 1200, progressRows: 0 }),
    progress: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue('retrying'),
    ...overrides,
  };
}

describe('durable import queue worker', () => {
  it('checkpoints progress and completes idempotently', async () => {
    const repository = repo();
    const handlers = createImportQueueHandlers(repository, { checkpointEvery: 500 });
    await handlers.importProcess!({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' });
    expect(repository.progress).toHaveBeenNthCalledWith(1, expect.anything(), 500);
    expect(repository.progress).toHaveBeenLastCalledWith(expect.anything(), 1200);
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it('resumes from persisted progress without replaying earlier rows', async () => {
    const repository = repo({ claim: vi.fn().mockResolvedValue({ importId: 'import-1', accountId: 'account-1', attempt: 2, totalRows: 1200, progressRows: 500 }) });
    await createImportQueueHandlers(repository, { checkpointEvery: 500 }).importProcess!({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' });
    expect(repository.progress).toHaveBeenNthCalledWith(1, expect.anything(), 1000);
    expect(repository.progress).toHaveBeenLastCalledWith(expect.anything(), 1200);
  });

  it('persists failures before allowing transient retry', async () => {
    const error = new Error('storage read failed');
    const repository = repo({ progress: vi.fn().mockRejectedValue(error), fail: vi.fn().mockResolvedValue('retrying') });
    await expect(createImportQueueHandlers(repository).importProcess!({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' })).rejects.toThrow('storage read failed');
    expect(repository.fail).toHaveBeenCalledWith(expect.anything(), 'storage read failed');
  });

  it('acknowledges after durable dead-letter evidence is recorded', async () => {
    const repository = repo({ progress: vi.fn().mockRejectedValue(new Error('malformed source')), fail: vi.fn().mockResolvedValue('dead_lettered') });
    await expect(createImportQueueHandlers(repository).importProcess!({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' })).resolves.toBeUndefined();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid checkpoint interval before claiming work', () => {
    expect(() => createImportQueueHandlers(repo(), { checkpointEvery: Number.NaN })).toThrow('finite positive number');
    expect(() => createImportQueueHandlers(repo(), { checkpointEvery: 0 })).toThrow('finite positive number');
  });

  it('records malformed durable lease progress before the queue retries', async () => {
    const repository = repo({
      claim: vi.fn().mockResolvedValue({ importId: 'import-1', accountId: 'account-1', attempt: 2, totalRows: 10, progressRows: 11 }),
      fail: vi.fn().mockResolvedValue('retrying'),
    });
    await expect(createImportQueueHandlers(repository).importProcess!({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' })).rejects.toThrow('outside the total row range');
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({ progressRows: 11 }), 'Import lease progress is outside the total row range.');
    expect(repository.progress).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
