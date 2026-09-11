import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('production market-data approval boundary', () => {
  it('keeps paid launch blocked until rights and commercial-plan evidence exist', async () => {
    const record = await readFile(new URL('../../docs/PRODUCTION_MARKET_DATA_APPROVAL.md', import.meta.url), 'utf8');
    expect(record).toContain('pending_rights_review');
    expect(record).toMatch(/storage\/display terms permit the intended paid use/i);
    expect(record).toMatch(/commercial plan/i);
    expect(record).toMatch(/no automatic upgrade/i);
    expect(record).toMatch(/server-side/i);
  });

  it('requires reviewer and evidence fields rather than an implied approval', async () => {
    const record = await readFile(new URL('../../docs/PRODUCTION_MARKET_DATA_APPROVAL.md', import.meta.url), 'utf8');
    for (const term of ['Independent reviewer', 'evidence links', 'source revision', 'share-alike']) expect(record).toContain(term);
    expect(record).toMatch(/launch gate must fail/i);
  });
});
