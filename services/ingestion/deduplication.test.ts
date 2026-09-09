import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { activityFingerprint, excludeOverlappingActivities, type FingerprintableActivity } from '@/services/ingestion/deduplication';

const sample = (): FingerprintableActivity => ({ accountId: 'account', effectiveDate: isoDate('2026-01-02'), type: 'buy', symbol: 'vti', quantity: decimalString('1'), price: decimalString('100'), amount: decimalString('-100'), description: 'Market  buy' });

describe('multiplicity-aware activity deduplication', () => {
  it('treats formatting-equivalent activity as the same fingerprint', () => {
    expect(activityFingerprint(sample())).toBe(activityFingerprint({ ...sample(), symbol: 'VTI', description: 'Market buy' }));
  });

  it('removes only the overlapping count while preserving a legitimate repeated trade', () => {
    const existing = [sample()];
    const incoming = [sample(), sample()];
    const result = excludeOverlappingActivities(existing, incoming);
    expect(result.duplicates).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
  });

  it('does not treat two same-day trades as duplicates without a prior committed copy', () => {
    const result = excludeOverlappingActivities([], [sample(), sample()]);
    expect(result).toMatchObject({ accepted: [expect.anything(), expect.anything()], duplicates: [] });
  });
});
