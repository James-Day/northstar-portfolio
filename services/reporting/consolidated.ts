import type { DailyClose, IsoDate } from '@/lib/domain/types';
import { valueLedgerHistory, type ValuationDate, type ValuationHistory } from '@/services/calculations/valuation';
import { applyFifoLedger, type LedgerEvent, type LedgerResult } from '@/services/ledger/fifo';
import type { TransferLink, UnresolvedTransfer } from '@/services/ledger/transfers';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';

export type ConsolidatedAccountInput = {
  accountId: string;
  inputs: PersistedReportInputs;
};

export type ConsolidatedReportInputs = {
  valuation: PersistedReportInputs['valuation'];
  ledger: LedgerResult;
  activityCoveredThrough: IsoDate | null;
  pricesThrough: IsoDate | null;
  importStateRevision: string;
  /** Linked transfer groups that could not be safely cancelled. */
  unresolvedTransfers: UnresolvedTransfer[];
};

/**
 * Composes all account ledgers into one consolidated calculation input.
 *
 * Internal transfers are removed only when a persisted reconciliation has
 * proved that the inbound and outbound rows match. Deposits, withdrawals and
 * IRA incentives remain in the event stream, so Modified Dietz can continue
 * to treat them as external flows or excluded incentives. Missing closes are
 * deliberately retained as missing; the consolidated history therefore stays
 * unavailable for that date instead of carrying a price from another date.
 */
export function composeConsolidatedReportInputs(input: {
  accounts: ConsolidatedAccountInput[];
  dates?: ValuationDate[];
  links?: TransferLink[];
  unresolvedTransfers?: UnresolvedTransfer[];
}): ConsolidatedReportInputs {
  if (input.accounts.length === 0) throw new Error('At least one account is required for a consolidated report.');

  const events = input.accounts.flatMap((account) => account.inputs.valuation.events);
  const transferEvents = new Map(events.filter(isTransferEvent).map((event) => [event.id, event]));
  const linkedIds = new Set<string>();
  const unresolvedTransfers = [...(input.unresolvedTransfers ?? [])];
  for (const link of input.links ?? []) {
    const inbound = transferEvents.get(link.incomingId);
    const outbound = transferEvents.get(link.outgoingId);
    if (!inbound || !outbound || inbound.type !== 'transfer_in' || outbound.type !== 'transfer_out') {
      unresolvedTransfers.push({ transferGroupId: link.transferGroupId, ids: [link.incomingId, link.outgoingId], reason: 'Linked transfer rows are not present in the consolidated ledger.' });
      continue;
    }
    linkedIds.add(inbound.id);
    linkedIds.add(outbound.id);
  }

  const consolidatedEvents = events
    .filter((event) => !linkedIds.has(event.id))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  const dates = input.dates ?? commonDates(input.accounts);
  const closes = mergeCloses(input.accounts.flatMap((account) => account.inputs.valuation.closes));
  const openingLots = input.accounts.flatMap((account) => account.inputs.valuation.openingLots.map((lot) => ({ ...lot, id: `${account.accountId}:${lot.id}` })));
  const pricesThrough = minimumDate(input.accounts.map((account) => account.inputs.pricesThrough));
  const activityCoveredThrough = minimumDate(input.accounts.map((account) => account.inputs.activityCoveredThrough));
  const ledger = applyFifoLedger(consolidatedEvents, openingLots);

  return {
    valuation: { dates, events: consolidatedEvents, openingLots, closes, corporateActions: mergeCorporateActions(input.accounts) },
    ledger,
    activityCoveredThrough,
    pricesThrough,
    importStateRevision: `consolidated:${input.accounts.flatMap((account) => account.inputs.importStateRevision).sort().join('|') || 'empty'}`,
    unresolvedTransfers,
  };
}

/** Calculates a consolidated history after cancelling only proven links. */
export function calculateConsolidatedReport(input: Parameters<typeof composeConsolidatedReportInputs>[0]): { inputs: ConsolidatedReportInputs; history: ValuationHistory } {
  const inputs = composeConsolidatedReportInputs(input);
  return { inputs, history: valueLedgerHistory(inputs.valuation) };
}

function isTransferEvent(event: LedgerEvent): event is LedgerEvent & { type: 'transfer_in' | 'transfer_out' } {
  return event.type === 'transfer_in' || event.type === 'transfer_out';
}

function commonDates(accounts: ConsolidatedAccountInput[]): ValuationDate[] {
  const first = accounts[0].inputs.valuation.dates;
  return first.filter((date) => accounts.every((account) => account.inputs.valuation.dates.some((candidate) => candidate.date === date.date)))
    .map((date) => ({ ...date, canChainFromPrevious: accounts.every((account) => account.inputs.valuation.dates.find((candidate) => candidate.date === date.date)?.canChainFromPrevious ?? false) }));
}

function mergeCloses(closes: DailyClose[]): DailyClose[] {
  const byKey = new Map<string, DailyClose>();
  for (const close of closes) {
    const key = `${close.instrumentId}:${close.tradingDate}`;
    const existing = byKey.get(key);
    if (existing && existing.close !== close.close) throw new Error(`Conflicting closes for ${close.instrumentId} on ${close.tradingDate}.`);
    if (!existing || close.sourceRevision.localeCompare(existing.sourceRevision) > 0) byKey.set(key, close);
  }
  return [...byKey.values()].sort((left, right) => left.tradingDate.localeCompare(right.tradingDate) || left.instrumentId.localeCompare(right.instrumentId));
}

function mergeCorporateActions(accounts: ConsolidatedAccountInput[]) {
  const byKey = new Map<string, PersistedReportInputs['valuation']['corporateActions'][number]>();
  for (const action of accounts.flatMap((account) => account.inputs.valuation.corporateActions)) {
    const key = `${action.instrumentId}:${action.effectiveDate}:${action.type}`;
    const existing = byKey.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(action)) throw new Error(`Conflicting corporate actions for ${action.instrumentId} on ${action.effectiveDate}.`);
    byKey.set(key, action);
  }
  return [...byKey.values()];
}

function minimumDate(values: Array<IsoDate | null>): IsoDate | null {
  const present = values.filter((value): value is IsoDate => value !== null);
  if (present.length !== values.length || present.length === 0) return null;
  return present.reduce((minimum, value) => value < minimum ? value : minimum, present[0]);
}
