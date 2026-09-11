import { describe, expect, it, vi } from 'vitest';
import { runRawFileRetention, type RetentionCandidate } from '@/services/privacy/retention-executor';

const candidate = (id: string, attempt = 1): RetentionCandidate => ({ id, importId: `11111111-1111-4111-8111-${id.padStart(12, '0')}`, objectPath: `user/account/${id}.csv`, uploadedAt: new Date('2026-01-01T00:00:00Z'), deletedAt: null, attempt });

function repo(items: RetentionCandidate[]) {
  return { claim: vi.fn().mockResolvedValue(items), markDeleted: vi.fn().mockResolvedValue(undefined), markFailure: vi.fn().mockResolvedValue('retrying' as const) };
}

describe('raw file retention executor', () => {
  it('deletes and verifies each claimed object before recording completion', async () => {
    const repository = repo([candidate('1')]);
    const storage = { delete: vi.fn().mockResolvedValue(undefined), verifyDeleted: vi.fn().mockResolvedValue(true) };
    const result = await runRawFileRetention({ repository, storage, now: () => new Date('2026-02-01T00:00:00Z') });
    expect(result).toEqual({ claimed: 1, deleted: 1, retrying: 0, exhausted: 0 });
    expect(storage.delete).toHaveBeenCalledWith('user/account/1.csv');
    expect(repository.markDeleted).toHaveBeenCalledOnce();
    expect(repository.markFailure).not.toHaveBeenCalled();
  });

  it('records a retry when deletion fails or verification finds the object', async () => {
    const repository = repo([candidate('2')]);
    const storage = { delete: vi.fn().mockRejectedValue(new Error('temporary storage outage')), verifyDeleted: vi.fn() };
    const now = new Date('2026-02-01T00:00:00Z');
    const result = await runRawFileRetention({ repository, storage, now: () => now, retryDelayMs: 90_000 });
    expect(result).toMatchObject({ claimed: 1, deleted: 0, retrying: 1 });
    expect(repository.markFailure).toHaveBeenCalledWith(expect.any(String), { at: now, retryAt: new Date('2026-02-01T00:01:30Z'), error: 'temporary storage outage', maxAttempts: 8, attempt: 1 });
  });

  it('keeps processing the batch and records exhausted attempts', async () => {
    const repository = repo([candidate('3', 8), candidate('4')]);
    repository.markFailure.mockResolvedValueOnce('exhausted').mockResolvedValueOnce('retrying');
    const storage = { delete: vi.fn().mockRejectedValue(new Error('no access')), verifyDeleted: vi.fn() };
    await expect(runRawFileRetention({ repository, storage })).resolves.toEqual({ claimed: 2, deleted: 0, retrying: 1, exhausted: 1 });
    expect(repository.markFailure).toHaveBeenCalledTimes(2);
  });

  it('does not mark an object deleted when post-delete verification fails', async () => {
    const repository = repo([candidate('5')]);
    const storage = { delete: vi.fn().mockResolvedValue(undefined), verifyDeleted: vi.fn().mockResolvedValue(false) };
    await runRawFileRetention({ repository, storage });
    expect(repository.markDeleted).not.toHaveBeenCalled();
    expect(repository.markFailure).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: 'Private object still exists after deletion.' }));
  });

  it('redacts URLs and credential-shaped values from durable failure evidence', async () => {
    const repository = repo([candidate('6')]);
    const storage = { delete: vi.fn().mockRejectedValue(new Error('request https://storage.test/object?token=abc authorization: Bearer-secret')), verifyDeleted: vi.fn() };
    await runRawFileRetention({ repository, storage });
    const error = repository.markFailure.mock.calls[0][1].error;
    expect(error).toContain('[redacted-url]');
    expect(error).toContain('authorization=[redacted]');
    expect(error).not.toContain('abc');
  });
});
