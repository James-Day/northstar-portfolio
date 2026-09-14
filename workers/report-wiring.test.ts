import { describe, expect, it } from 'vitest';
import { resolveReportThroughDate } from './api';

describe('report worker date wiring', () => {
  it('uses the explicit report-through date when configured', () => {
    expect(resolveReportThroughDate({ REPORT_THROUGH_DATE: '2026-09-11' }, new Date('2030-01-01T00:00:00Z'))).toBe('2026-09-11');
  });

  it('falls back to the current UTC date so an empty deployment variable does not disable the queue', () => {
    expect(resolveReportThroughDate({ REPORT_THROUGH_DATE: '' }, new Date('2026-09-14T23:30:00Z'))).toBe('2026-09-14');
    expect(resolveReportThroughDate({}, new Date('2026-02-03T01:02:03Z'))).toBe('2026-02-03');
  });

  it('rejects an explicitly malformed report-through date', () => {
    expect(() => resolveReportThroughDate({ REPORT_THROUGH_DATE: '2026-02-30' })).toThrow('Invalid calendar date: 2026-02-30');
  });
});
