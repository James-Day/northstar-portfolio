import Decimal from 'decimal.js';
import type { DecimalString } from '@/lib/domain/money';

export type InternalTransfer = {
  id: string;
  transferGroupId: string;
  direction: 'in' | 'out';
  accountId: string;
  instrumentId: string | null;
  quantity: DecimalString | null;
  cashAmount: DecimalString;
};

export type TransferLink = { transferGroupId: string; incomingId: string; outgoingId: string };
export type UnresolvedTransfer = { transferGroupId: string; ids: string[]; reason: string };

export function linkInternalTransfers(transfers: InternalTransfer[]): { linked: TransferLink[]; unresolved: UnresolvedTransfer[] } {
  const grouped = new Map<string, InternalTransfer[]>();
  for (const transfer of transfers) grouped.set(transfer.transferGroupId, [...(grouped.get(transfer.transferGroupId) ?? []), transfer]);
  const linked: TransferLink[] = [];
  const unresolved: UnresolvedTransfer[] = [];

  for (const [transferGroupId, entries] of grouped) {
    const incoming = entries.filter((entry) => entry.direction === 'in');
    const outgoing = entries.filter((entry) => entry.direction === 'out');
    if (incoming.length !== 1 || outgoing.length !== 1) {
      unresolved.push({ transferGroupId, ids: entries.map((entry) => entry.id), reason: 'Transfer group must contain exactly one inbound and one outbound entry.' });
      continue;
    }
    const [inbound] = incoming;
    const [outbound] = outgoing;
    if (inbound.accountId === outbound.accountId) {
      unresolved.push({ transferGroupId, ids: [inbound.id, outbound.id], reason: 'Transfer entries must belong to different accounts.' });
      continue;
    }
    const quantitiesMatch = inbound.quantity === null && outbound.quantity === null || inbound.quantity !== null && outbound.quantity !== null && new Decimal(inbound.quantity).eq(outbound.quantity);
    if (inbound.instrumentId !== outbound.instrumentId || !quantitiesMatch || !new Decimal(inbound.cashAmount).plus(outbound.cashAmount).eq(0)) {
      unresolved.push({ transferGroupId, ids: [inbound.id, outbound.id], reason: 'Transfer value, instrument, or quantity does not reconcile.' });
      continue;
    }
    linked.push({ transferGroupId, incomingId: inbound.id, outgoingId: outbound.id });
  }
  return { linked, unresolved };
}
