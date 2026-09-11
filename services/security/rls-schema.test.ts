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

const ownerPolicyContracts: Record<string, RegExp> = {
  profiles: /create\s+policy\s+profiles_owner[\s\S]*?on\s+public\.profiles[\s\S]*?for\s+all[\s\S]*?using\s*\(\s*id\s*=\s*auth\.uid\(\)[\s\S]*?with\s+check\s*\(\s*id\s*=\s*auth\.uid\(\)/,
  accounts: /create\s+policy\s+accounts_owner[\s\S]*?on\s+public\.accounts[\s\S]*?for\s+all[\s\S]*?using\s*\(\s*user_id\s*=\s*auth\.uid\(\)[\s\S]*?with\s+check\s*\(\s*user_id\s*=\s*auth\.uid\(\)/,
  imports: /create\s+policy\s+imports_owner[\s\S]*?on\s+public\.imports[\s\S]*?auth\.uid\(\)/,
  import_source_rows: /create\s+policy\s+import_source_rows_owner[\s\S]*?on\s+public\.import_source_rows[\s\S]*?auth\.uid\(\)/,
  ledger_entries: /create\s+policy\s+ledger_entries_owner[\s\S]*?on\s+public\.ledger_entries[\s\S]*?auth\.uid\(\)/,
  lots: /create\s+policy\s+lots_owner[\s\S]*?on\s+public\.lots[\s\S]*?auth\.uid\(\)/,
  report_snapshots: /create\s+policy\s+report_snapshots_owner[\s\S]*?on\s+public\.report_snapshots[\s\S]*?auth\.uid\(\)/,
  billing_customers: /create\s+policy\s+billing_customer_owner[\s\S]*?on\s+public\.billing_customers[\s\S]*?for\s+select[\s\S]*?user_id\s*=\s*auth\.uid\(\)/,
  audit_events: /create\s+policy\s+audit_events_owner[\s\S]*?on\s+public\.audit_events[\s\S]*?for\s+select[\s\S]*?user_id\s*=\s*auth\.uid\(\)/,
  account_opening_history: /create\s+policy\s+account_opening_history_owner[\s\S]*?on\s+public\.account_opening_history[\s\S]*?auth\.uid\(\)/,
  lot_matches: /create\s+policy\s+lot_matches_owner[\s\S]*?on\s+public\.lot_matches[\s\S]*?auth\.uid\(\)/,
  import_issue_resolutions: /create\s+policy\s+import_issue_resolutions_owner[\s\S]*?on\s+public\.import_issue_resolutions[\s\S]*?auth\.uid\(\)/,
  internal_transfer_reconciliations: /create\s+policy\s+internal_transfer_reconciliations_owner[\s\S]*?on\s+public\.internal_transfer_reconciliations[\s\S]*?auth\.uid\(\)/,
  raw_file_retention: /create\s+policy\s+raw_file_retention_owner[\s\S]*?on\s+public\.raw_file_retention[\s\S]*?auth\.uid\(\)/,
  raw_file_retention_audit: /create\s+policy\s+raw_file_retention_audit_owner[\s\S]*?on\s+public\.raw_file_retention_audit[\s\S]*?auth\.uid\(\)/,
  billing_webhook_events: /create\s+policy\s+billing_webhook_events_owner[\s\S]*?on\s+public\.billing_webhook_events[\s\S]*?for\s+select[\s\S]*?user_id\s*=\s*auth\.uid\(\)/,
  user_deletion_requests: /create\s+policy\s+user_deletion_requests_owner[\s\S]*?on\s+public\.user_deletion_requests[\s\S]*?for\s+select[\s\S]*?user_id\s*=\s*auth\.uid\(\)/,
  user_deletion_plan_items: /create\s+policy\s+user_deletion_plan_items_owner[\s\S]*?on\s+public\.user_deletion_plan_items[\s\S]*?for\s+select[\s\S]*?user_id\s*=\s*auth\.uid\(\)/,
};

const serviceOwnedTables = [
  'job_outbox',
  'queue_rejections',
  'market_data_job_runs',
  'market_data_quota_buckets',
  'market_data_quota_reservations',
  'historical_seed_jobs',
  'historical_seed_mappings',
  'historical_seed_quarantine',
  'historical_seed_pages',
  'billing_webhook_events',
];

// These tables are shared reference/projection data. Clients may read the
// rows exposed by their SELECT policies, but all writes must come from the
// trusted worker/database functions. Keeping this inventory explicit makes a
// newly-added global table fail CI until its intended boundary is reviewed.
const globalReadOnlyTables = [
  'instruments',
  'instrument_aliases',
  'corporate_actions',
  'price_revisions',
  'daily_prices',
  'price_corrections',
];

const userOwnedTables = [
  'profiles',
  'accounts',
  'imports',
  'import_source_rows',
  'ledger_entries',
  'lots',
  'report_snapshots',
  'billing_customers',
  'audit_events',
  'raw_file_retention',
  'raw_file_retention_audit',
  'user_deletion_requests',
  'user_deletion_plan_items',
  'account_opening_history',
  'lot_matches',
  'internal_transfer_reconciliations',
  'import_issue_resolutions',
];

function unique(values: string[]) {
  return [...new Set(values)];
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

    for (const name of serviceOwnedTables) {
      expect(sql, `${name} must revoke client privileges`).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+[^;]*public\\.${name}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`),
      );
    }
  });

  it('classifies every migrated table exactly once', async () => {
    const sql = await migrationSql();
    const names = unique(tableNames(sql));
    const classified = [...userOwnedTables, ...serviceOwnedTables, ...globalReadOnlyTables];

    expect(unique(classified), 'table inventories must not overlap').toHaveLength(classified.length);
    expect(unique(classified).sort()).toEqual(names.sort());
  });

  it('protects global reference tables from guessed-ID and direct client writes', async () => {
    const sql = await migrationSql();
    for (const name of globalReadOnlyTables) {
      expect(sql, `${name} must revoke direct client writes`).toMatch(
        new RegExp(`revoke\\s+(?:all|insert\\s*,\\s*update\\s*,\\s*delete)\\s+on\\s+[^;]*public\\.${name}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`),
      );
      expect(sql, `${name} must grant client reads explicitly`).toMatch(
        new RegExp(`grant\\s+select\\s+on\\s+[^;]*public\\.${name}[^;]*to\\s+(?:anon\\s*,\\s*authenticated|authenticated\\s*,\\s*anon)`),
      );
    }
  });

  it('requires every user-owned table to expose only an auth.uid ownership boundary', async () => {
    const sql = await migrationSql();
    for (const name of userOwnedTables) {
      expect(sql, `${name} must have an RLS owner policy`).toMatch(
        new RegExp(`create\\s+policy\\s+[a-z0-9_]+[\\s\\S]*?on\\s+public\\.${name}[\\s\\S]*?auth\\.uid\\s*\\(\\s*\\)`),
      );
    }
  });

  it('requires every user-owned table to have an auth.uid-scoped policy', async () => {
    const sql = await migrationSql();
    for (const [name, contract] of Object.entries(ownerPolicyContracts)) {
      expect(sql, `${name} must have an owner-scoped policy`).toMatch(contract);
    }
  });

  it('does not leave a guessed-ID write path on derived service projections', async () => {
    const sql = await migrationSql();
    for (const name of ['report_snapshots', 'lot_matches', 'internal_transfer_reconciliations']) {
      expect(sql, `${name} must explicitly revoke direct client writes`).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+[^;]*public\\.${name}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`),
      );
      expect(sql, `${name} must grant only authenticated reads`).toMatch(
        new RegExp(`grant\\s+select\\s+on\\s+public\\.${name}\\s+to\\s+authenticated`),
      );
    }
  });

  it('locks immutable source evidence and derived projections against direct writes', async () => {
    const sql = await migrationSql();
    for (const name of ['imports', 'import_source_rows', 'report_snapshots', 'lot_matches', 'internal_transfer_reconciliations']) {
      expect(sql, `${name} must revoke direct writes`).toMatch(
        new RegExp(`revoke\\s+(?:all|insert\\s*,\\s*update\\s*,\\s*delete)\\s+on\\s+[^;]*public\\.${name}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`),
      );
    }
  });

  it('does not grant browser mutation privileges through any migration', async () => {
    const sql = await migrationSql();
    const browserRoles = '(?:public\\s*,\\s*)?(?:anon\\s*,\\s*)?authenticated';

    // A later migration can accidentally reopen a table that an earlier
    // hardening migration closed. Inspect the complete migration stream and
    // reject every explicit client INSERT/UPDATE/DELETE grant for tables that
    // are intentionally service-owned or globally reference-only.
    for (const name of [...serviceOwnedTables, ...globalReadOnlyTables]) {
      expect(sql, `${name} must never grant browser mutations`).not.toMatch(
        new RegExp(`grant\\s+(?:all|(?:insert|update|delete)(?:\\s*,\\s*(?:insert|update|delete)){0,2})\\s+on\\s+[^;]*public\\.${name}[^;]*\\s+to\\s+${browserRoles}`),
      );
    }
  });

  it('requires every user-owned policy expression to bind the authenticated owner', async () => {
    const sql = await migrationSql();
    for (const name of userOwnedTables) {
      const policies = [...sql.matchAll(/create\s+policy\s+[a-z0-9_]+[\s\S]*?;/g)]
        .filter(([policy]) => new RegExp(`on\\s+public\\.${name}(?![a-z0-9_])`).test(policy));
      expect(policies, `${name} must declare at least one policy`).not.toHaveLength(0);
      for (const [policy] of policies) {
        expect(policy, `${name} policy must reference auth.uid()`).toMatch(/auth\.uid\s*\(\s*\)/);
        expect(policy, `${name} policy must not use an unconditional true boundary`).not.toMatch(/using\s*\(\s*true\s*\)/);
      }
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
