import { consumeQueueMessages, type QueueConsumeResult, type QueueHandlers, type QueueMessage } from './consumer';
import type { QueueFailureRecorder } from './failure-evidence';
export type CloudflareQueueMessage = QueueMessage;
export type CloudflareQueueBatch = { messages: readonly CloudflareQueueMessage[] };
export type QueueHandlerResolver<Environment> = (environment: Environment, executionContext: ExecutionContext) => QueueHandlers | Promise<QueueHandlers>;
export function createCloudflareQueueHandler<Environment>(resolveHandlers: QueueHandlerResolver<Environment>, options: { queueName?: string; resolveFailureRecorder?: (environment: Environment, executionContext: ExecutionContext) => QueueFailureRecorder | Promise<QueueFailureRecorder> } = {}) {
  return async (batch: CloudflareQueueBatch, environment: Environment, executionContext: ExecutionContext): Promise<QueueConsumeResult> => {
    const handlers = await resolveHandlers(environment, executionContext);
    const failureRecorder = options.resolveFailureRecorder ? await options.resolveFailureRecorder(environment, executionContext) : undefined;
    return consumeQueueMessages([...batch.messages], handlers, { queueName: options.queueName, failureRecorder });
  };
}
