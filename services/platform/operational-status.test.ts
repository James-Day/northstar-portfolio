import { describe, expect, it } from 'vitest';
import { summarizeOperationalStatus } from './operational-status';

describe('operational status', () => {
  it('prioritizes critical recovery signals without exposing error details', () => {
    const result = summarizeOperationalStatus({ marketData: { staleSymbols: 2 }, queues: { failedJobs: 1, pendingJobs: 200 }, retention: { pendingItems: 101 }, reports: { staleJobs: 3 } });
    expect(result.severity).toBe('critical');
    expect(result.signals.map((signal) => signal.component)).toEqual(['market_data', 'queues', 'retention', 'reports']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns an explicit healthy status when no worker signals are present', () => {
    expect(summarizeOperationalStatus({})).toEqual({ severity: 'ok', signals: [] });
  });

  it('flags a stopped refresh job even when no individual symbol is marked stale', () => {
    const result = summarizeOperationalStatus({ now: new Date('2026-09-12T12:00:00Z'), marketData: { lastSuccessfulAt: new Date('2026-09-10T00:00:00Z') } });
    expect(result).toEqual({ severity: 'warning', signals: [expect.objectContaining({ component: 'market_data', message: expect.stringContaining('No successful market-data refresh') })] });
  });

  it('rejects invalid freshness thresholds', () => {
    expect(() => summarizeOperationalStatus({ marketData: { maxSuccessAgeMs: 0 } })).toThrow('freshness threshold');
  });
});
