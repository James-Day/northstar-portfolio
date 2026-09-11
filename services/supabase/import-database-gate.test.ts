import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { excludeOverlappingActivities, type FingerprintableActivity } from '@/services/ingestion/deduplication';

type ImportStatus = 'ready_for_review' | 'committed' | 'undone';
type SourceRow = FingerprintableActivity & { rowNumber: number; importId: string };
type AuditEvent = { kind: 'commit' | 'undo' | 'reject'; importId: string; reason?: string };
type DbState = {
  imports: Map<string, { id: string; fileHash: string; status: ImportStatus }>;
  sourceRows: Map<string, SourceRow[]>;
  ledger: SourceRow[];
  audit: AuditEvent[];
};

const activity = (overrides: Partial<FingerprintableActivity> = {}): FingerprintableActivity => ({
  accountId: 'account-1',
  effectiveDate: isoDate('2026-01-02'),
  type: 'buy',
  symbol: 'VTI',
  quantity: decimalString('1'),
  price: decimalString('100'),
  amount: decimalString('-100'),
  description: 'Market buy',
  ...overrides,
});

function cloneState(state: DbState): DbState {
  return {
    imports: new Map([...state.imports].map(([id, value]) => [id, { ...value }])),
    sourceRows: new Map([...state.sourceRows].map(([id, rows]) => [id, rows.map((row) => ({ ...row }))])),
    ledger: state.ledger.map((row) => ({ ...row })),
    audit: state.audit.map((event) => ({ ...event })),
  };
}

function stage(state: DbState, input: { id: string; fileHash: string; rows: FingerprintableActivity[] }): string {
  const activeDuplicate = [...state.imports.values()].find((item) => item.fileHash === input.fileHash && item.status !== 'undone');
  if (activeDuplicate) return activeDuplicate.id;
  state.imports.set(input.id, { id: input.id, fileHash: input.fileHash, status: 'ready_for_review' });
  state.sourceRows.set(input.id, input.rows.map((row, index) => ({ ...row, rowNumber: index + 1, importId: input.id })));
  return input.id;
}

function commit(state: DbState, importId: string): void {
  const record = state.imports.get(importId);
  const rows = state.sourceRows.get(importId) ?? [];
  if (!record || record.status !== 'ready_for_review') throw new Error('Only review-ready imports can be committed.');
  if (rows.some((row) => !row.symbol || row.amount === decimalString('0'))) {
    throw new Error('Resolve invalid or unsupported rows before committing.');
  }
  const next = cloneState(state);
  next.ledger.push(...rows);
  next.imports.get(importId)!.status = 'committed';
  next.audit.push({ kind: 'commit', importId });
  Object.assign(state, next);
}

function undo(state: DbState, importId: string): void {
  const record = state.imports.get(importId);
  if (!record || record.status !== 'committed') throw new Error('Only committed imports can be undone.');
  const next = cloneState(state);
  next.ledger = next.ledger.filter((row) => row.importId !== importId);
  next.imports.get(importId)!.status = 'undone';
  next.audit.push({ kind: 'undo', importId });
  Object.assign(state, next);
}

function rejectWithAudit(state: DbState, importId: string, reason: string): void {
  state.audit.push({ kind: 'reject', importId, reason });
}

function createState(): DbState {
  return { imports: new Map(), sourceRows: new Map(), ledger: [], audit: [] };
}

describe('database-shaped import acceptance gate', () => {
  it('deduplicates a repeated active file but permits the same file after undo', () => {
    const state = createState();
    const row = activity();
    expect(stage(state, { id: 'first-import', fileHash: 'same-file', rows: [row] })).toBe('first-import');
    expect(stage(state, { id: 'retry-import', fileHash: 'same-file', rows: [row] })).toBe('first-import');
    commit(state, 'first-import');
    undo(state, 'first-import');
    expect(stage(state, { id: 'reimport', fileHash: 'same-file', rows: [row] })).toBe('reimport');
  });

  it('preserves multiplicity for repeated trades while removing only overlap', () => {
    const repeatedTrade = activity();
    const result = excludeOverlappingActivities([repeatedTrade], [repeatedTrade, repeatedTrade]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
  });

  it('allows an undone file to be reimported while retaining its source and audit history', () => {
    const state = createState();
    const row = activity({ type: 'dividend', quantity: null, price: null, amount: decimalString('2') });
    stage(state, { id: 'import-1', fileHash: 'hash-1', rows: [row] });
    commit(state, 'import-1');
    undo(state, 'import-1');
    expect(stage(state, { id: 'import-2', fileHash: 'hash-1', rows: [row] })).toBe('import-2');
    expect(state.sourceRows.get('import-1')).toHaveLength(1);
    expect(state.audit.map((event) => event.kind)).toEqual(['commit', 'undo']);
  });

  it('rolls back a blocked commit without changing status or derived ledger rows', () => {
    const state = createState();
    stage(state, { id: 'blocked-import', fileHash: 'hash-blocked', rows: [activity({ symbol: null })] });
    expect(() => commit(state, 'blocked-import')).toThrow('Resolve invalid');
    rejectWithAudit(state, 'blocked-import', 'invalid source row');
    expect(state.imports.get('blocked-import')?.status).toBe('ready_for_review');
    expect(state.ledger).toHaveLength(0);
    expect(state.sourceRows.get('blocked-import')).toHaveLength(1);
    expect(state.audit.at(-1)).toEqual({ kind: 'reject', importId: 'blocked-import', reason: 'invalid source row' });
  });

  it('serializes concurrent commit and undo requests for the same import', async () => {
    const state = createState();
    stage(state, { id: 'raced-import', fileHash: 'hash-raced', rows: [activity()] });
    let tail = Promise.resolve();
    const serialized = (operation: () => void) => {
      const run = tail.then(operation);
      tail = run.catch(() => undefined);
      return run;
    };
    await Promise.all([
      serialized(() => commit(state, 'raced-import')),
      serialized(() => undo(state, 'raced-import')),
    ]);
    expect(state.imports.get('raced-import')?.status).toBe('undone');
    expect(state.ledger).toHaveLength(0);
    expect(state.audit.map((event) => event.kind)).toEqual(['commit', 'undo']);
  });

  it('serializes different imports at the account boundary without losing either commit', async () => {
    const state = createState();
    stage(state, { id: 'account-import-a', fileHash: 'hash-a', rows: [activity({ amount: decimalString('-100') })] });
    stage(state, { id: 'account-import-b', fileHash: 'hash-b', rows: [activity({ effectiveDate: isoDate('2026-01-03'), amount: decimalString('-25') })] });

    // This queue models PostgreSQL's transaction-scoped account advisory lock:
    // operations for one account wait for one another, while each transaction
    // still commits its full ledger projection atomically.
    const tails = new Map<string, Promise<void>>();
    const serializeAccount = (accountId: string, operation: () => void) => {
      const previous = tails.get(accountId) ?? Promise.resolve();
      const current = previous.then(operation);
      tails.set(accountId, current.catch(() => undefined));
      return current;
    };
    await Promise.all([
      serializeAccount('account-1', () => commit(state, 'account-import-a')),
      serializeAccount('account-1', () => commit(state, 'account-import-b')),
    ]);
    expect([...state.imports.values()].map((item) => item.status)).toEqual(['committed', 'committed']);
    expect(state.ledger.map((entry) => entry.importId)).toEqual(['account-import-a', 'account-import-b']);
    expect(state.audit.map((event) => event.kind)).toEqual(['commit', 'commit']);
  });
});
