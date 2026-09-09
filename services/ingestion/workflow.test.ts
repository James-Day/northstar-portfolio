import { describe, expect, it } from 'vitest';
import { assertImportCanCommit, buildImportReview, transitionImport } from '@/services/ingestion/workflow';

describe('import workflow', () => {
  it('allows the durable staging path and undo, but not a second undo', () => {
    expect(transitionImport(transitionImport(transitionImport('staged', 'processing'), 'ready_for_review'), 'committed')).toBe('committed');
    expect(transitionImport('committed', 'undone')).toBe('undone');
    expect(() => transitionImport('undone', 'undone')).toThrow('Cannot transition');
  });

  it('blocks a commit with material unsupported activity', () => {
    const review = buildImportReview([{ status: 'supported' }, { status: 'unsupported', materiallyAffectsReports: true }]);
    expect(() => assertImportCanCommit(review)).toThrow('material unsupported');
  });

  it('accepts a clean reviewed import', () => {
    expect(() => assertImportCanCommit(buildImportReview([{ status: 'supported' }, { status: 'duplicate' }]))).not.toThrow();
  });
});
