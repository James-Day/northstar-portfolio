import { createCloudflareQueueHandler, type CloudflareQueueBatch, type QueueHandlerResolver } from '@/services/queues/cloudflare';
import type { QueueHandlers } from '@/services/queues/consumer';
import type { QueueJob } from '@/services/queues/contracts';

export type PriceQueueDependencyResolver<Environment> = (
  environment: Environment,
  executionContext: ExecutionContext,
) => { refresh: (job: Extract<QueueJob, { kind: 'price.refresh' }>) => Promise<void> } | Promise<{ refresh: (job: Extract<QueueJob, { kind: 'price.refresh' }>) => Promise<void> }>;

/** Binds price-refresh jobs to a server-only dependency resolver. */
export function createPriceQueueHandler<Environment>(
  resolveDependencies: PriceQueueDependencyResolver<Environment>,
  options: Parameters<typeof createCloudflareQueueHandler<Environment>>[1] = {},
) {
  const resolveHandlers: QueueHandlerResolver<Environment> = async (environment, executionContext): Promise<Pick<QueueHandlers, 'priceRefresh'>> => {
    const dependencies = await resolveDependencies(environment, executionContext);
    return { priceRefresh: dependencies.refresh };
  };
  return createCloudflareQueueHandler(resolveHandlers, options);
}

/** Useful for local queue emulators that pass a batch through explicitly. */
export async function consumePriceQueueBatch<Environment>(
  batch: CloudflareQueueBatch,
  environment: Environment,
  executionContext: ExecutionContext,
  resolveDependencies: PriceQueueDependencyResolver<Environment>,
) {
  return createPriceQueueHandler(resolveDependencies)(batch, environment, executionContext);
}
