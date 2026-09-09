import { describe, expect, it } from 'vitest';
import { markRawFileDeleted, rawFilesEligibleForDeletion } from '@/services/privacy/retention';

describe('raw statement retention', () => {
  it('selects un-deleted files at the 30-day boundary and keeps newer files', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const files = [
      { importId: 'eligible', objectPath: 'user/eligible.csv', uploadedAt: new Date('2026-01-02T00:00:00Z'), deletedAt: null },
      { importId: 'recent', objectPath: 'user/recent.csv', uploadedAt: new Date('2026-01-03T00:00:00Z'), deletedAt: null },
      { importId: 'deleted', objectPath: 'user/deleted.csv', uploadedAt: new Date('2025-01-01T00:00:00Z'), deletedAt: new Date('2025-02-01T00:00:00Z') },
    ];
    expect(rawFilesEligibleForDeletion(files, now).map((file) => file.importId)).toEqual(['eligible']);
  });

  it('records a deletion only once for auditability', () => {
    const file = { importId: 'import', objectPath: 'user/import.csv', uploadedAt: new Date(), deletedAt: null };
    const deleted = markRawFileDeleted(file, new Date('2026-01-01T00:00:00Z'));
    expect(() => markRawFileDeleted(deleted, new Date())).toThrow('already deleted');
  });
});
