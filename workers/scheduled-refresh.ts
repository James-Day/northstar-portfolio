import { runScheduledPriceRefresh, type ScheduledRefreshDependencies } from '@/services/market-data/scheduled-refresh';

export type ScheduledEventLike = { scheduledTime: number };
export type ScheduledExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

/** Cloudflare cron adapter; dependency construction stays in deployment wiring. */
export function handleScheduledRefresh(event: ScheduledEventLike, context: ScheduledExecutionContextLike, dependencies: ScheduledRefreshDependencies): void {
  context.waitUntil(runScheduledPriceRefresh(new Date(event.scheduledTime), dependencies));
}
