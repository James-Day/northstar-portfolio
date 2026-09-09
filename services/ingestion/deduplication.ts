import { createHash } from 'node:crypto';
import type { DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';

export type FingerprintableActivity = {
  accountId: string;
  effectiveDate: IsoDate;
  type: string;
  symbol: string | null;
  quantity: DecimalString | null;
  price: DecimalString | null;
  amount: DecimalString;
  description: string;
};

export function activityFingerprint(activity: FingerprintableActivity): string {
  const canonical = [
    activity.accountId,
    activity.effectiveDate,
    activity.type,
    activity.symbol?.trim().toUpperCase() ?? '',
    activity.quantity ?? '',
    activity.price ?? '',
    activity.amount,
    activity.description.trim().replace(/\s+/g, ' '),
  ].join('\u001f');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export type DeduplicationResult<T extends FingerprintableActivity> = {
  accepted: T[];
  duplicates: T[];
};

/**
 * Compares counts per fingerprint, rather than treating a fingerprint as unique.
 * That preserves genuinely repeated trades while excluding exact overlap with
 * activity that was already committed.
 */
export function excludeOverlappingActivities<T extends FingerprintableActivity>(existing: T[], incoming: T[]): DeduplicationResult<T> {
  const alreadyCommitted = new Map<string, number>();
  for (const activity of existing) {
    const fingerprint = activityFingerprint(activity);
    alreadyCommitted.set(fingerprint, (alreadyCommitted.get(fingerprint) ?? 0) + 1);
  }
  const consumedDuplicates = new Map<string, number>();
  const accepted: T[] = [];
  const duplicates: T[] = [];
  for (const activity of incoming) {
    const fingerprint = activityFingerprint(activity);
    const consumed = consumedDuplicates.get(fingerprint) ?? 0;
    if (consumed < (alreadyCommitted.get(fingerprint) ?? 0)) {
      consumedDuplicates.set(fingerprint, consumed + 1);
      duplicates.push(activity);
    } else {
      accepted.push(activity);
    }
  }
  return { accepted, duplicates };
}
