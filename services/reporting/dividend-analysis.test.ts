import { describe, expect, it } from 'vitest';
import { analyzeDividends } from '@/services/reporting/dividend-analysis';

describe('dividend analysis', () => {
  const events = [
    { eventId: 'a', date: '2025-01-15', instrumentId: 'VTI', amount: '10' },
    { eventId: 'b', date: '2025-04-15', instrumentId: 'VTI', amount: '12' },
    { eventId: 'c', date: '2025-07-15', instrumentId: 'VTI', amount: '11' },
    { eventId: 'd', date: '2025-07-20', instrumentId: 'MSFT', amount: '5' },
  ];

  it('groups exact income by day, month, and year', () => {
    const result = analyzeDividends(events, '2025-07-31');
    expect(result.total).toBe('38');
    expect(result.daily).toEqual([
      { period: '2025-01-15', amount: '10', eventCount: 1 },
      { period: '2025-04-15', amount: '12', eventCount: 1 },
      { period: '2025-07-15', amount: '11', eventCount: 1 },
      { period: '2025-07-20', amount: '5', eventCount: 1 },
    ]);
    expect(result.monthly).toEqual([
      { period: '2025-01', amount: '10', eventCount: 1 },
      { period: '2025-04', amount: '12', eventCount: 1 },
      { period: '2025-07', amount: '16', eventCount: 2 },
    ]);
    expect(result.yearly).toEqual([{ period: '2025', amount: '38', eventCount: 4 }]);
  });

  it('projects recurring payments from historical cadence and excludes one-off history', () => {
    const result = analyzeDividends(events, '2025-07-31');
    expect(result.projectionMethod).toBe('historical_cadence');
    expect(result.projectedMonthly.length).toBeGreaterThan(0);
    expect(result.projectedMonthly.every((row) => row.projected)).toBe(true);
    expect(result.projectedMonthly[0].amount).toBe('11');
    expect(result.projectedMonthly.some((row) => row.period === '2025-10')).toBe(true);
  });

  it('reports insufficient history when no instrument has two payments', () => {
    const result = analyzeDividends([{ eventId: 'one', date: '2025-01-01', amount: '2' }], '2025-01-01');
    expect(result.projectionMethod).toBe('insufficient_history');
    expect(result.projectedMonthly).toEqual([]);
  });
});
