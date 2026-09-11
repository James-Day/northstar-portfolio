import { parseQueueJob, type QueueJob } from './contracts';
import { sanitizeQueueEvidence, type QueueFailureRecorder } from './failure-evidence';

export type QueueMessage<T = unknown> = { body: T; ack(): void; retry(options?: { delaySeconds?: number }): void };
export type QueueHandlers = {
  importProcess?: (job: Extract<QueueJob, { kind: 'import.process' }>) => Promise<void>;
  reportRecompute?: (job: Extract<QueueJob, { kind: 'report.recompute' }>) => Promise<void>;
  priceRefresh?: (job: Extract<QueueJob, { kind: 'price.refresh' }>) => Promise<void>;
};
export type QueueConsumeResult = { acknowledged: number; retried: number; rejected: number };

/** Dispatches validated jobs. Invalid payloads are durably recorded before acknowledgement. */
export async function consumeQueueMessages(messages: QueueMessage[], handlers: QueueHandlers, options: { failureRecorder?: QueueFailureRecorder; queueName?: string } = {}): Promise<QueueConsumeResult> {
  const result: QueueConsumeResult = { acknowledged: 0, retried: 0, rejected: 0 };
  for (const message of messages) {
    let job: QueueJob;
    try { job = parseQueueJob(message.body); } catch {
      try {
        await options.failureRecorder?.record({ queueName: options.queueName, payload: sanitizeQueueEvidence(message.body), reason: 'Invalid queue job payload.' });
        message.ack(); result.rejected += 1;
      } catch { message.retry({ delaySeconds: 60 }); result.retried += 1; }
      continue;
    }
    const handler = job.kind === 'import.process' ? handlers.importProcess : job.kind === 'report.recompute' ? handlers.reportRecompute : handlers.priceRefresh;
    if (!handler) { message.retry({ delaySeconds: 60 }); result.retried += 1; continue; }
    try { await handler(job as never); message.ack(); result.acknowledged += 1; }
    catch (error) {
      try { await options.failureRecorder?.record({ queueName: options.queueName, payload: sanitizeQueueEvidence(job), reason: sanitizeQueueEvidence(error instanceof Error ? error.message : 'Queue handler failed.') as string }); } catch { /* retry remains safest if evidence cannot be persisted */ }
      message.retry({ delaySeconds: 60 }); result.retried += 1;
    }
  }
  return result;
}
