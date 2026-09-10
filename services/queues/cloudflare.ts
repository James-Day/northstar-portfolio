import { consumeQueueMessages, type QueueConsumeResult, type QueueHandlers, type QueueMessage } from './consumer';

/**
 * The subset of a Cloudflare Queue message used by the dispatcher. Keeping
 * this structural makes the adapter testable without a Miniflare runtime and
 * prevents provider types from leaking into the queue contracts.
 */
export type CloudflareQueueMessage = QueueMessage;

export type CloudflareQueueBatch = {
  messages: readonly CloudflareQueueMessage[];
};

export type QueueHandlerResolver<Environment> = (
  environment: Environment,
  executionContext: ExecutionContext,
) => QueueHandlers | Promise<QueueHandlers>;

/**
 * Adapts Cloudflare's batch callback to the provider-neutral dispatcher.
 * Handler resolution is injected so production wiring can supply repositories
 * and services without coupling the queue module to Worker environment shape.
 *
 * An empty handler map is safe: malformed messages are acknowledged as
 * rejected poison messages, while valid messages are retried until a durable
 * business handler is configured.
 */
export function createCloudflareQueueHandler<Environment>(resolveHandlers: QueueHandlerResolver<Environment>) {
  return async (batch: CloudflareQueueBatch, environment: Environment, executionContext: ExecutionContext): Promise<QueueConsumeResult> => {
    const handlers = await resolveHandlers(environment, executionContext);
    return consumeQueueMessages([...batch.messages], handlers);
  };
}
