import { runRawFileRetention, type PrivateObjectStore, type RetentionClaimRepository } from '@/services/privacy/retention-executor';

export type ScheduledRetentionEvent = { scheduledTime: number };
export type ScheduledRetentionContext = { waitUntil(promise: Promise<unknown>): void };

export function handleScheduledRetention(
  event: ScheduledRetentionEvent,
  context: ScheduledRetentionContext,
  dependencies: { repository: RetentionClaimRepository; storage: PrivateObjectStore },
): void {
  context.waitUntil(runRawFileRetention({ repository: dependencies.repository, storage: dependencies.storage, now: () => new Date(event.scheduledTime) }));
}
