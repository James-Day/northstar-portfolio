import type { InstrumentAlias } from '@/lib/domain/types';
import { resolveInstrumentAlias } from '@/services/instruments/resolver';
import { linkInternalTransfers, type InternalTransfer, type TransferLink, type UnresolvedTransfer } from '@/services/ledger/transfers';

export type PersistedTransferRow = {
  id: string;
  accountId: string;
  effectiveDate: string;
  entryType: 'transfer_in' | 'transfer_out';
  transferGroupId: string | null;
  instrumentId: string | null;
  symbol: string | null;
  quantity: string | null;
  cashAmount: string;
};

export type TransferReconciliation = {
  transfers: InternalTransfer[];
  linked: TransferLink[];
  unresolved: UnresolvedTransfer[];
};

/**
 * Converts the durable ledger projection into transfer pairs. A missing group,
 * missing alias, or ambiguous effective alias is retained as an unresolved
 * record instead of being treated as an external cash flow.
 */
export function reconcilePersistedTransfers(rows: PersistedTransferRow[], aliases: InstrumentAlias[] = []): TransferReconciliation {
  const unresolved: UnresolvedTransfer[] = [];
  const transfers: InternalTransfer[] = [];
  for (const row of rows.filter((candidate) => candidate.entryType === 'transfer_in' || candidate.entryType === 'transfer_out')) {
    if (!row.transferGroupId) {
      unresolved.push({ transferGroupId: `entry:${row.id}`, ids: [row.id], reason: 'Transfer entry has no internal transfer group.' });
      continue;
    }
    let instrumentId = row.instrumentId;
    if (!instrumentId && row.symbol) {
      try {
        instrumentId = resolveInstrumentAlias(aliases, row.symbol, row.effectiveDate as never) ?? null;
      } catch (error) {
        unresolved.push({ transferGroupId: row.transferGroupId, ids: [row.id], reason: error instanceof Error ? error.message : 'Instrument alias is ambiguous.' });
        continue;
      }
      if (!instrumentId) {
        unresolved.push({ transferGroupId: row.transferGroupId, ids: [row.id], reason: `No effective instrument alias exists for ${row.symbol} on ${row.effectiveDate}.` });
        continue;
      }
    }
    transfers.push({
      id: row.id,
      transferGroupId: row.transferGroupId,
      direction: row.entryType === 'transfer_in' ? 'in' : 'out',
      accountId: row.accountId,
      instrumentId,
      quantity: row.quantity as InternalTransfer['quantity'],
      cashAmount: row.cashAmount as InternalTransfer['cashAmount'],
    });
  }
  const linkedResult = linkInternalTransfers(transfers);
  return { transfers, linked: linkedResult.linked, unresolved: [...unresolved, ...linkedResult.unresolved] };
}
