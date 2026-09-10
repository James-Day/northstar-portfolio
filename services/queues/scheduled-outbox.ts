import { dispatchOutbox, type OutboxDispatchResult, type OutboxJobPublisher, type OutboxRepository } from './outbox-dispatcher';

/** The small subset of a Cloudflare Queue binding needed by the outbox worker. */
export type QueueProducer = { send(body: unknown): Promise<void> };

export type OutboxDispatchDependencies = {
  repository: OutboxRepository;
  reportQueue: QueueProducer;
  limit?: number;
  maxAttempts?: number;
  now?: () => Date;
};

/** Publishes committed database events to the report queue and completes rows only after send succeeds. */
export function runScheduledOutboxDispatch(input: OutboxDispatchDependencies): Promise<OutboxDispatchResult> {
  const publish: OutboxJobPublisher = (job) => input.reportQueue.send(job);
  return dispatchOutbox({ repository: input.repository, publish, limit: input.limit, maxAttempts: input.maxAttempts, now: input.now });
}

/** Keeps the dispatch promise alive after the cron handler returns. */
export function handleScheduledOutboxDispatch(context: { waitUntil(promise: Promise<unknown>): void }, input: OutboxDispatchDependencies): void {
  context.waitUntil(runScheduledOutboxDispatch(input));
}
