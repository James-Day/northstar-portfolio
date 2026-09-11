import { describe, expect, it } from 'vitest';
import { parseQueueJob } from '@/services/queues/contracts';

describe('queue job contracts', () => {
  it('accepts a valid price refresh date', () => {
    expect(parseQueueJob({ kind: 'price.refresh', symbols: ['AAPL'], date: '2026-02-27' })).toEqual({
      kind: 'price.refresh', symbols: ['AAPL'], date: '2026-02-27',
    });
  });

  it('rejects impossible calendar dates before queue dispatch', () => {
    expect(() => parseQueueJob({ kind: 'price.refresh', symbols: ['AAPL'], date: '2026-02-30' })).toThrow(/valid calendar date/);
  });
});
