import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/20260913110000_deduplicate_drip_dividends.sql', import.meta.url), 'utf8');

describe('persisted DRIP dividend semantics', () => {
  it('suppresses derived income when an explicit dividend already exists', () => {
    expect(migration).toMatch(/new\.description like '%\(reinvested dividend income\)'[\s\S]*existing\.entry_type = 'dividend'[\s\S]*existing\.description not like '%\(reinvested dividend income\)'/i);
    expect(migration).toMatch(/return null;/i);
  });

  it('removes a derived event when the explicit row is inserted later', () => {
    expect(migration).toMatch(/delete from public\.ledger_entries derived[\s\S]*derived\.description like '%\(reinvested dividend income\)'/i);
    expect(migration).toMatch(/after insert or update on public\.ledger_entries/i);
  });
});
