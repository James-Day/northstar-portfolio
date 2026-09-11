import Decimal from 'decimal.js';
import type { ParsedRobinhoodRow, RobinhoodActivityType } from '@/services/ingestion/robinhood';

export type AcceptedFixtureRowExpectation = {
  rowNumber: number;
  type: RobinhoodActivityType;
  symbol: string | null;
  quantity: string | null;
  amount: string;
};

export type AcceptedFixtureExpectation = {
  rows: AcceptedFixtureRowExpectation[];
  resolvedSymbols: string[];
};

export type AcceptedFixtureReconciliation = {
  rowCount: number;
  cashAmount: string;
  quantitiesBySymbol: Record<string, string>;
};

/**
 * Acceptance boundary for trusted fixture evidence. A fixture is accepted only
 * when every source row is supported, has finite economic values, and matches
 * an independently authored row manifest. The explicit symbol allowlist keeps
 * a parser-successful but unresolved asset from looking like a complete account.
 */
export function reconcileAcceptedFixture(
  rows: ParsedRobinhoodRow[],
  expected: AcceptedFixtureExpectation,
): AcceptedFixtureReconciliation {
  if (rows.length === 0) throw new Error('Accepted fixture cannot be empty.');
  if (rows.length !== expected.rows.length) {
    throw new Error(`Accepted fixture row count mismatch: expected ${expected.rows.length}, received ${rows.length}.`);
  }

  const resolvedSymbols = new Set(expected.resolvedSymbols.map((symbol) => symbol.trim().toUpperCase()));
  let cash = new Decimal(0);
  const quantities = new Map<string, Decimal>();
  const expectedRowNumbers = new Set<number>();

  rows.forEach((row, index) => {
    const expectedRow = expected.rows[index];
    if (expectedRowNumbers.has(expectedRow.rowNumber)) throw new Error(`Accepted fixture manifest repeats row ${expectedRow.rowNumber}.`);
    expectedRowNumbers.add(expectedRow.rowNumber);
    if (row.rowNumber !== expectedRow.rowNumber) throw new Error(`Accepted fixture row ${index + 1} has unexpected source row number.`);
    if (row.status !== 'supported' || !row.activity) {
      throw new Error(`Accepted fixture row ${row.rowNumber} is ${row.status}; unresolved rows cannot be accepted.`);
    }

    const activity = row.activity;
    if (activity.type !== expectedRow.type || activity.symbol !== expectedRow.symbol || activity.quantity !== expectedRow.quantity) {
      throw new Error(`Accepted fixture row ${row.rowNumber} quantity/activity mismatch.`);
    }
    assertDecimal(activity.amount, `row ${row.rowNumber} amount`);
    if (!new Decimal(activity.amount).eq(expectedRow.amount)) throw new Error(`Accepted fixture row ${row.rowNumber} cash amount mismatch.`);
    if (activity.quantity !== null) {
      assertDecimal(activity.quantity, `row ${row.rowNumber} quantity`);
      if (new Decimal(activity.quantity).lte(0)) throw new Error(`Accepted fixture row ${row.rowNumber} quantity must be positive.`);
    }
    if (requiresResolvedSymbol(activity.type)) {
      if (!activity.symbol || !resolvedSymbols.has(activity.symbol)) {
        throw new Error(`Accepted fixture row ${row.rowNumber} has no resolved instrument for ${activity.symbol ?? '(blank)'}.`);
      }
    }

    cash = cash.plus(activity.amount);
    if (activity.symbol && activity.quantity !== null && ['buy', 'drip_buy', 'sell'].includes(activity.type)) {
      const signedQuantity = ['sell'].includes(activity.type) ? new Decimal(activity.quantity).negated() : new Decimal(activity.quantity);
      quantities.set(activity.symbol, (quantities.get(activity.symbol) ?? new Decimal(0)).plus(signedQuantity));
    }
  });

  const expectedCash = expected.rows.reduce((total, row) => total.plus(row.amount), new Decimal(0));
  if (!cash.eq(expectedCash)) throw new Error('Accepted fixture cash total did not reconcile.');
  const quantitiesBySymbol = Object.fromEntries([...quantities.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([symbol, quantity]) => [symbol, quantity.toFixed()]));
  return { rowCount: rows.length, cashAmount: cash.toFixed(), quantitiesBySymbol };
}

function assertDecimal(value: string, label: string): void {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) throw new Error();
  } catch {
    throw new Error(`Accepted fixture ${label} is not a finite decimal.`);
  }
}

function requiresResolvedSymbol(type: RobinhoodActivityType): boolean {
  return type === 'buy' || type === 'sell' || type === 'dividend' || type === 'drip_buy';
}
