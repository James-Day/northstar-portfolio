import { describe, expect, it } from 'vitest';
import { labelForInstrument, mapInstrumentLabels } from '@/services/reporting/instrument-labels';

describe('instrument labels', () => {
  it('prefers stored display names and falls back to stable IDs', () => {
    const labels = [{ instrumentId: 'a', displayName: 'Apple Inc.' }, { instrumentId: 'b', displayName: '  ' }];
    expect(labelForInstrument('a', labels)).toBe('Apple Inc.');
    expect(labelForInstrument('b', labels)).toBe('b');
    expect(mapInstrumentLabels(['a', 'a', 'b'], labels)).toEqual({ a: 'Apple Inc.', b: 'b' });
  });
});
