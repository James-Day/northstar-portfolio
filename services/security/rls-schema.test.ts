import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

async function migrationSql() {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  return (await Promise.all(names.map((name) => readFile(`${migrationsDirectory}/${name}`, 'utf8')))).join('\n').toLowerCase();
}

function tableNames(sql: string) {
  return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)].map((match) => match[1]);
}

describe('database security migration contract', () => {
  it('enables RLS on every public table declared by migrations', async () => {
    const sql = await migrationSql();
    const names = [...new Set(tableNames(sql))];
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(sql, `${name} must enable row-level security`).toMatch(
        new RegExp(`alter\\s+table\\s+public\\.${name}\\s+enable\\s+row\\s+level\\s+security`),
      );
    }
  });

  it('explicitly removes client privileges from service-owned tables', async () => {
    const sql = await migrationSql();
    const serviceTables = [
      'job_outbox',
      'queue_rejections',
      'market_data_job_runs',
      'market_data_quota_buckets',
      'market_data_quota_reservations',
      'historical_seed_jobs',
      'historical_seed_mappings',
      'historical_seed_quarantine',
    ];

    for (const name of serviceTables) {
      expect(sql, `${name} must revoke client privileges`).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+[^;]*public\\.${name}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`),
      );
    }
  });

  it('keeps brokerage statements private and scoped to the authenticated owner', async () => {
    const sql = await migrationSql();
    expect(sql).toMatch(/insert\s+into\s+storage\.buckets[\s\S]*brokerage-statements[\s\S]*false/);
    expect(sql).toMatch(/create\s+policy\s+brokerage_statement_select[\s\S]*storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/);
    expect(sql).toMatch(/create\s+policy\s+brokerage_statement_insert[\s\S]*storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/);
    expect(sql).toMatch(/create\s+policy\s+brokerage_statement_delete[\s\S]*storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/);
  });

  it('requires security-definer functions to pin search_path', async () => {
    const sql = await migrationSql();
    const unsafe = [...sql.matchAll(/security\s+definer(?![^;]*search_path\s*=)/g)];
    expect(unsafe, 'security-definer functions must pin search_path').toHaveLength(0);
  });
});
