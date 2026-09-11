import { runUserDeletion, type DeletionPlanRepository, type DeletionRunResult, type DeletionSideEffects } from '@/services/privacy/deletion-executor';

export type ScheduledDeletionDependencies = {
  repository: DeletionPlanRepository;
  effects: DeletionSideEffects;
  limit?: number;
  maxAttempts?: number;
};

/** Cloudflare cron adapter for durable deletion plans. Each side effect is
 * injected by deployment wiring so this worker cannot silently invent a
 * storage, billing, or auth implementation. */
export function handleScheduledDeletion(
  event: { scheduledTime: number },
  context: { waitUntil(promise: Promise<unknown>): void },
  dependencies: ScheduledDeletionDependencies,
): void {
  context.waitUntil(runUserDeletion({
    repository: dependencies.repository,
    effects: dependencies.effects,
    limit: dependencies.limit,
    maxAttempts: dependencies.maxAttempts,
    now: () => new Date(event.scheduledTime),
  }));
}

export async function runScheduledDeletion(
  now: Date,
  dependencies: ScheduledDeletionDependencies,
): Promise<DeletionRunResult> {
  return runUserDeletion({
    repository: dependencies.repository,
    effects: dependencies.effects,
    limit: dependencies.limit,
    maxAttempts: dependencies.maxAttempts,
    now: () => now,
  });
}
