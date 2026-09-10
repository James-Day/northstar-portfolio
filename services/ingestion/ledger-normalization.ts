import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { ParsedRobinhoodRow, RobinhoodActivityType } from '@/services/ingestion/robinhood';
import type { IsoDate } from '@/lib/domain/types';

export type LedgerEntryDraft = {
  sourceRowNumber: number;
  effectiveDate: IsoDate;
  entryType: RobinhoodActivityType;
  instrumentId: string | null;
  quantity: DecimalString | null;
  unitPrice: DecimalString | null;
  cashAmount: DecimalString;
  externalFlow: boolean;
  description: string;
};

/**
 * Creates the immutable ledger drafts that a later atomic commit persists.
 * It intentionally refuses unresolved instruments instead of guessing ticker
 * identity, and models a DRIP as income plus a cash-neutral reinvestment buy.
 */
export function normalizeRobinhoodRowsForLedger(
  rows: ParsedRobinhoodRow[],
  instrumentIdBySymbol: ReadonlyMap<string, string>,
): LedgerEntryDraft[] {
  const entries: LedgerEntryDraft[] = [];
  for (const row of rows) {
    if (row.status !== 'supported' || !row.activity) continue;
    const activity = row.activity;
    // SPL rows are persisted as corporate_actions by the commit RPC. They do
    // not create cash or lot entries in the ledger projection.
    if (activity.type === 'split') continue;
    const instrumentId = needsInstrument(activity.type) ? resolveInstrument(activity.symbol, instrumentIdBySymbol, row.rowNumber) : null;
    const base: Omit<LedgerEntryDraft, 'entryType' | 'cashAmount'> = {
      sourceRowNumber: row.rowNumber,
      effectiveDate: activity.effectiveDate,
      instrumentId,
      quantity: activity.quantity,
      unitPrice: activity.price,
      externalFlow: activity.type === 'deposit' || activity.type === 'withdrawal',
      description: activity.description,
    };
    if (activity.type === 'drip_buy') {
      const dividendAmount = decimalString(new Decimal(activity.amount).abs().toFixed());
      entries.push({ ...base, entryType: 'dividend', quantity: null, unitPrice: null, cashAmount: dividendAmount, externalFlow: false, description: `${activity.description} (reinvested dividend income)` });
      entries.push({ ...base, entryType: 'drip_buy', cashAmount: decimalString(new Decimal(activity.amount).abs().negated().toFixed()), externalFlow: false });
      continue;
    }
    entries.push({ ...base, entryType: activity.type, cashAmount: activity.amount });
  }
  return entries;
}

function needsInstrument(type: RobinhoodActivityType): boolean {
  return type === 'buy' || type === 'sell' || type === 'dividend' || type === 'drip_buy';
}

function resolveInstrument(symbol: string | null, instrumentIdBySymbol: ReadonlyMap<string, string>, rowNumber: number): string {
  if (!symbol) throw new Error(`Row ${rowNumber} requires an instrument symbol.`);
  const instrumentId = instrumentIdBySymbol.get(symbol);
  if (!instrumentId) throw new Error(`Row ${rowNumber} has no resolved instrument for ${symbol}.`);
  return instrumentId;
}
