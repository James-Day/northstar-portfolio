import { describe, expect, it } from 'vitest';
import { summarizeOperationalStatus } from './operational-status';

describe('operational status', () => {
  it('prioritizes critical recovery signals without exposing error details', () => {
    const result = summarizeOperationalStatus({ marketData: { staleSymbols: 2 }, queues: { failedJobs: 1, pendingJobs: 200 }, retention: { pendingItems: 101 }, reports: { staleJobs: 3 } });
    expect(result.severity).toBe('critical');
    expect(result.signals.map((signal) => signal.component)).toEqual(['market_data', 'queues', 'retention', 'reports']);
    expect(result.signals.every((signal) => signal.code && signal.action)).toBe(true);
    expect(result.nextAction).toContain('Inspect the failed job');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns an explicit healthy status when no worker signals are present', () => {
    expect(summarizeOperationalStatus({})).toEqual({ severity: 'ok', signals: [], nextAction: null });
  });

  it('flags a stopped refresh job even when no individual symbol is marked stale', () => {
    const result = summarizeOperationalStatus({ now: new Date('2026-09-12T12:00:00Z'), marketData: { lastSuccessfulAt: new Date('2026-09-10T00:00:00Z') } });
    expect(result).toEqual(expect.objectContaining({ severity: 'warning', signals: [expect.objectContaining({ component: 'market_data', message: expect.stringContaining('No successful market-data refresh'), code: 'market_data.refresh_overdue' })], nextAction: expect.stringContaining('Inspect the scheduled refresh') }));
  });

  it('reports import and recovery failures with deterministic operator actions', () => {
    const result = summarizeOperationalStatus({
      now: new Date('2026-09-13T12:00:00Z'),
      imports: { pendingReviews: 2 },
      recovery: { lastBackupAt: new Date('2026-09-11T00:00:00Z') },
    });
    expect(result.signals).toEqual([
      expect.objectContaining({ component: 'imports', code: 'imports.pending_review', severity: 'warning' }),
      expect.objectContaining({ component: 'recovery', code: 'recovery.backup_overdue', severity: 'critical' }),
    ]);
    expect(result.severity).toBe('critical');
    expect(result.nextAction).toContain('managed backup export');
    expect(JSON.stringify(result)).not.toMatch(/token|password|key|secret/i);
  });

  it('rejects negative counters instead of hiding monitoring failures', () => {
    expect(() => summarizeOperationalStatus({ queues: { failedJobs: -1 } })).toThrow('non-negative integer');
  });

  it('rejects malformed lower-priority counters even when a critical signal is present', () => {
    expect(() => summarizeOperationalStatus({ marketData: { quotaExhausted: true, staleSymbols: -1 } })).toThrow('staleSymbols must be a non-negative integer');
    expect(() => summarizeOperationalStatus({ imports: { failedImports: 1, unsupportedRows: 0.5 } })).toThrow('unsupportedRows must be a non-negative integer');
  });

  it('rejects invalid freshness thresholds', () => {
    expect(() => summarizeOperationalStatus({ marketData: { maxSuccessAgeMs: 0 } })).toThrow('freshness threshold');
  });
});
