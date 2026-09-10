import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';

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
export type AccountLot = { id: string; accountId: string; instrumentId: string; acquiredOn: string | null; quantity: DecimalString; remainingQuantity: DecimalString; totalCostBasis: DecimalString | null };

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

/** Carries transferred share lots into the receiving account without changing basis. */
export function applyLinkedLotTransfers(lots: AccountLot[], transfers: InternalTransfer[], links: TransferLink[]): { lots: AccountLot[]; unresolved: UnresolvedTransfer[] } {
  const byId = new Map(transfers.map((transfer) => [transfer.id, transfer]));
  const result = lots.map((lot) => ({ ...lot }));
  const unresolved: UnresolvedTransfer[] = [];
  for (const link of links) {
    const inbound = byId.get(link.incomingId);
    const outbound = byId.get(link.outgoingId);
    if (!inbound || !outbound || inbound.quantity === null) continue;
    if (outbound.quantity === null || inbound.instrumentId === null || outbound.instrumentId !== inbound.instrumentId) {
      unresolved.push({ transferGroupId: link.transferGroupId, ids: [link.incomingId, link.outgoingId], reason: 'Share transfer requires matching instrument quantities.' });
      continue;
    }
    let remaining = new Decimal(inbound.quantity);
    const candidates = result.filter((lot) => lot.accountId === outbound.accountId && lot.instrumentId === outbound.instrumentId && new Decimal(lot.remainingQuantity).gt(0)).sort((left, right) => (left.acquiredOn ?? '').localeCompare(right.acquiredOn ?? '') || left.id.localeCompare(right.id));
    const consumed: Array<{ lot: AccountLot; matched: Decimal }> = [];
    for (const lot of candidates) {
      if (remaining.lte(0)) break;
      const matched = Decimal.min(new Decimal(lot.remainingQuantity), remaining);
      consumed.push({ lot, matched });
      remaining = remaining.minus(matched);
    }
    if (remaining.gt(0)) {
      unresolved.push({ transferGroupId: link.transferGroupId, ids: [link.incomingId, link.outgoingId], reason: `Transferred quantity exceeds available lots by ${remaining.toFixed()}.` });
      continue;
    }
    for (const { lot, matched } of consumed) {
      lot.remainingQuantity = decimalString(new Decimal(lot.remainingQuantity).minus(matched).toFixed());
      const basis = lot.totalCostBasis === null ? null : decimalString(new Decimal(lot.totalCostBasis).times(matched).div(lot.quantity).toFixed());
      result.push({ ...lot, id: `${inbound.id}:${lot.id}`, accountId: inbound.accountId, quantity: decimalString(matched.toFixed()), remainingQuantity: decimalString(matched.toFixed()), totalCostBasis: basis });
    }
  }
  return { lots: result.filter((lot) => new Decimal(lot.remainingQuantity).gt(0)), unresolved };
}
