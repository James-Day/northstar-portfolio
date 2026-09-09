import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { accountTypeLabel, validateOpeningHistory } from '@/services/accounts/opening-history';

describe('opening history', () => {
  it('requires a disclosure when basis or history is incomplete', () => {
    expect(() => validateOpeningHistory({ openingCash: decimalString('0'), activityCoveredFrom: null, incompleteReason: null, positions: [] })).toThrow('explicit explanation');
  });

  it('keeps unknown basis and acquisition date explicitly unknown', () => {
    expect(validateOpeningHistory({ openingCash: decimalString('100'), activityCoveredFrom: isoDate('2026-01-01'), incompleteReason: 'Imported history begins after account opening.', positions: [{ instrumentId: 'vti', quantity: decimalString('1.25'), acquiredOn: null, totalCostBasis: null }] }).positions[0]).toMatchObject({ acquiredOn: null, totalCostBasis: null });
  });

  it('labels supported account types', () => {
    expect(accountTypeLabel('roth_ira')).toBe('Roth IRA');
  });
});
