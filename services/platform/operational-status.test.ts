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
});
