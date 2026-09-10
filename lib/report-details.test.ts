import { describe, expect, it } from 'vitest';
import { buildAllocationRows } from '@/lib/report-details';

describe('report detail presentation helpers', () => {
  it('allocates persisted holdings and cash against total value', () => {
    expect(
      buildAllocationRows(
        [
          { instrumentId: 'AAPL', value: '75' },
          {
            instrumentId: 'VTI',
            displayName: 'Vanguard Total Stock',
            value: '20',
          },
        ],
        '5',
        '100',
      ),
    ).toMatchObject([
      { key: 'AAPL', percentage: 75 },
      { key: 'VTI', label: 'Vanguard Total Stock', percentage: 20 },
      { key: 'cash', percentage: 5 },
    ]);
  });

  it('does not invent allocation when valuation is unavailable', () => {
    expect(
      buildAllocationRows([{ instrumentId: 'AAPL', value: null }], null, null),
    ).toEqual([]);
  });
});
