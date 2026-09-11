import { describe, expect, it } from 'vitest';
import { resolvedNonReportableRowIds } from './issue-resolution-view';

describe('issue-resolution review state', () => {
  it('restores only non-reportable source-row resolutions', () => {
    const result = resolvedNonReportableRowIds({
      resolutions: [
        { sourceRowId: 'row-1', resolutionKind: 'non_reportable' },
        { sourceRowId: 'row-2', resolutionKind: 'alias_confirmed' },
        { sourceRowId: null, resolutionKind: 'non_reportable' },
      ],
    });
    expect(result).toEqual(new Set(['row-1']));
  });

  it('fails closed for malformed responses', () => {
    expect(resolvedNonReportableRowIds({ resolutions: [{ sourceRowId: 42, resolutionKind: 'non_reportable' }] })).toEqual(new Set());
    expect(resolvedNonReportableRowIds(null)).toEqual(new Set());
  });
});
