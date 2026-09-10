import { z } from 'zod';

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date.');

export const importJobSchema = z.object({
  kind: z.literal('import.process'),
  importId: id,
  accountId: id,
  requestedBy: id,
});

export const reportJobSchema = z.object({
  kind: z.literal('report.recompute'),
  accountId: id,
  requestedBy: id,
  reason: z.enum(['import_committed', 'import_undone', 'price_updated', 'manual_retry']),
});

export const priceJobSchema = z.object({
  kind: z.literal('price.refresh'),
  symbols: z.array(z.string().trim().min(1)).min(1).max(500),
  date: isoDate,
});

export const queueJobSchema = z.discriminatedUnion('kind', [importJobSchema, reportJobSchema, priceJobSchema]);
export type QueueJob = z.infer<typeof queueJobSchema>;

export function parseQueueJob(value: unknown): QueueJob {
  return queueJobSchema.parse(value);
}
