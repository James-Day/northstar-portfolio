import type { QueueJob } from './contracts';

export type QueueFailureEvidence = { queueName?: string; payload: unknown; reason: string; attempts?: number };
export type QueueFailureRecorder = { record(input: QueueFailureEvidence): Promise<void> };
export type QueueReplayRepository = { replay(id: string): Promise<QueueJob | undefined> };

const SENSITIVE_KEY = /(authorization|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|service[_-]?role)/i;

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000);
}

/** Keeps durable queue evidence useful while preventing malformed payloads/errors from storing credentials. */
export function sanitizeQueueEvidence(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (depth >= 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeQueueEvidence(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeQueueEvidence(item, depth + 1)]));
}

/** Records a rejection before the queue message is acknowledged. */
export function createQueueFailureRecorder(record: (input: QueueFailureEvidence) => Promise<void>): QueueFailureRecorder {
  return { record };
}
