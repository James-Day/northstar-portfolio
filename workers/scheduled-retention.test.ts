import { describe, expect, it, vi } from 'vitest';
import { handleScheduledRetention } from '@/workers/scheduled-retention';

describe('scheduled raw-file retention', () => {
  it('hands the scheduled timestamp to the bounded retention runner', async () => {
    const claim = vi.fn().mockResolvedValue([]);
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    handleScheduledRetention({ scheduledTime: Date.parse('2026-09-12T08:00:00Z') }, { waitUntil }, { repository: { claim, markDeleted: vi.fn(), markFailure: vi.fn() }, storage: { delete: vi.fn(), verifyDeleted: vi.fn() } });
    await waitUntil.mock.calls[0][0];
    expect(claim).toHaveBeenCalledWith(new Date('2026-09-12T08:00:00.000Z'), 100, 8);
  });
});
