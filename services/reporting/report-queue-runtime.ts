import { createCloudflareQueueHandler, type CloudflareQueueBatch, type QueueHandlerResolver } from '@/services/queues/cloudflare';
import { createReportRecomputeHandler, type ReportRecomputeDependencies } from '@/services/reporting/report-queue-handler';

/**
 * Binds the report recompute worker to a Cloudflare Queue.  Keeping dependency
 * resolution outside the queue adapter is deliberate: production can use a
 * service-role Supabase loader while tests can use a deterministic fixture.
 * The same adapter is therefore used for import -> outbox -> queue -> report
 * publication without allowing request handlers to calculate reports inline.
 */
export type ReportQueueDependencyResolver<Environment> = (
  environment: Environment,
  executionContext: ExecutionContext,
) => ReportRecomputeDependencies | Promise<ReportRecomputeDependencies>;

export function createReportQueueHandler<Environment>(
  resolveDependencies: ReportQueueDependencyResolver<Environment>,
  options: Parameters<typeof createCloudflareQueueHandler<Environment>>[1] = {},
) {
  const resolveHandlers: QueueHandlerResolver<Environment> = async (environment, executionContext) => ({
    reportRecompute: createReportRecomputeHandler(await resolveDependencies(environment, executionContext)),
  });
  return createCloudflareQueueHandler(resolveHandlers, options);
}

/** Useful for local queue emulators that pass a batch through explicitly. */
export async function consumeReportQueueBatch<Environment>(
  batch: CloudflareQueueBatch,
  environment: Environment,
  executionContext: ExecutionContext,
  resolveDependencies: ReportQueueDependencyResolver<Environment>,
) {
  return createReportQueueHandler(resolveDependencies)(batch, environment, executionContext);
}
