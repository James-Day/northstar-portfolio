import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = fileURLToPath(new URL('../../supabase/migrations/20260911110000_report_trigger_deduplication.sql', import.meta.url));

describe('database report trigger contract', () => {
  it('deduplicates commit and undo outbox events by source import', async () => {
    const sql = (await readFile(migration, 'utf8')).toLowerCase();
    expect(sql).toMatch(/event_type in \('import\.committed',\s*'import\.undone'\)/);
    expect(sql).toMatch(/new\.dedupe_key\s*:=\s*new\.event_type\s*\|\|\s*':'\s*\|\|\s*v_import_id/);
    expect(sql).toMatch(/before insert on public\.job_outbox/);
    expect(sql).toMatch(/on conflict \(dedupe_key\)[\s\S]*do nothing/);
  });

  it('routes inserted price corrections through the same report queue event', async () => {
    const sql = (await readFile(migration, 'utf8')).toLowerCase();
    expect(sql).toMatch(/create or replace function public\.enqueue_price_correction_report_outbox/);
    expect(sql).toMatch(/'price\.updated'/);
    expect(sql).toMatch(/join public\.imports i on i\.id = e\.import_id and i\.status = 'committed'/);
    expect(sql).toMatch(/create trigger price_corrections_enqueue_report_outbox/);
  });

  it('keeps provider price revisions and corrections reproducible in the event key', async () => {
    const sql = (await readFile(migration, 'utf8')).toLowerCase();
    expect(sql).toMatch(/coalesce\(new\.payload ->> 'pricerevisionid', new\.payload ->> 'correctionversion'\)/);
    expect(sql).toMatch(/v_account_id \|\| ':' \|\| v_instrument_id \|\| ':' \|\| v_trading_date \|\| ':' \|\| v_revision/);
  });
});
