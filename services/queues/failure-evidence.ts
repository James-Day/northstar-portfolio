import type { QueueJob } from './contracts';

export type QueueFailureEvidence = { queueName?: string; payload: unknown; reason: string; attempts?: number };
export type QueueFailureRecorder = { record(input: QueueFailureEvidence): Promise<void> };
export type QueueReplayRepository = { replay(id: string): Promise<QueueJob | undefined> };

/** Records a rejection before the queue message is acknowledged. */
export function createQueueFailureRecorder(record: (input: QueueFailureEvidence) => Promise<void>): QueueFailureRecorder {
  return { record };
}
