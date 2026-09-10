export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

/** A request body exceeded the endpoint's explicit memory/processing budget. */
export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super('Request body exceeds the allowed size.');
    this.name = 'RequestBodyTooLargeError';
  }
}

/**
 * Read a body with a byte cap before parsing it. Content-Length is only an
 * early rejection; the streaming check also covers chunked requests.
 */
export async function readRequestText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes)
      throw new RequestBodyTooLargeError(maxBytes);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonRequest(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  const text = await readRequestText(request, maxBytes);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError('Request body must be valid JSON.');
  }
}

/** Optional JSON bodies still reject oversized requests; only malformed or empty JSON becomes null. */
export async function readOptionalJsonRequest(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<unknown | null> {
  try {
    return await readJsonRequest(request, maxBytes);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export type RateLimitStore = {
  consume(
    key: string,
    now: number,
    limit: number,
    windowMs: number,
  ): RateLimitDecision | Promise<RateLimitDecision>;
};

/** Shared production counter contract. Implementations must increment and
 * rotate a bucket atomically (for example inside a Durable Object). */
export type AtomicRateLimitCounterStore = {
  increment(key: string, now: number, windowMs: number): Promise<{ windowStartedAt: number; count: number }>;
};

export class SharedRateLimitStore implements RateLimitStore {
  constructor(private readonly counters: AtomicRateLimitCounterStore) {}

  async consume(key: string, now: number, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const counter = await this.counters.increment(key, now, windowMs);
    const elapsed = Math.max(0, now - counter.windowStartedAt);
    return {
      allowed: counter.count <= limit,
      limit,
      remaining: Math.max(0, limit - counter.count),
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
    };
  }
}

type Counter = { windowStartedAt: number; count: number };

/**
 * Small edge-safe fixed-window limiter. Production deployments should provide
 * a shared Durable Object/KV-backed implementation; this fallback still
 * protects a warm Worker instance and keeps local development deterministic.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly maxKeys = 10_000) {}

  consume(
    key: string,
    now: number,
    limit: number,
    windowMs: number,
  ): RateLimitDecision {
    const current = this.counters.get(key);
    const counter =
      !current || now - current.windowStartedAt >= windowMs
        ? { windowStartedAt: now, count: 0 }
        : current;
    counter.count += 1;
    this.counters.set(key, counter);
    if (this.counters.size > this.maxKeys) {
      const oldest = this.counters.keys().next().value;
      if (oldest) this.counters.delete(oldest);
    }
    const elapsed = Math.max(0, now - counter.windowStartedAt);
    return {
      allowed: counter.count <= limit,
      limit,
      remaining: Math.max(0, limit - counter.count),
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
    };
  }
}

export function requestRateLimit(path: string, method: string) {
  if (path === '/health') return { limit: 120, windowMs: 60_000 };
  if (method === 'POST' || method === 'PUT' || method === 'DELETE')
    return { limit: 30, windowMs: 60_000 };
  return { limit: 120, windowMs: 60_000 };
}

export function requestClientKey(request: Request): string {
  // Cloudflare supplies this value at the edge. Do not trust arbitrary
  // X-Forwarded-For headers from clients when the Worker is not behind CF.
  return request.headers.get('cf-connecting-ip')?.trim() || 'anonymous';
}

export type SafeRequestLog = {
  requestId: string;
  method: string;
  path: string;
  status?: number;
  userId?: string;
};

/** Only structured, non-secret fields may cross the logging boundary. */
export function redactRequestLog(input: SafeRequestLog): SafeRequestLog {
  return {
    requestId: input.requestId.slice(0, 128),
    method: input.method.toUpperCase().slice(0, 16),
    path: input.path.split('?')[0].slice(0, 512),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.userId ? { userId: input.userId.slice(0, 128) } : {}),
  };
}

export function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim();
  return supplied ? supplied.slice(0, 128) : crypto.randomUUID();
}
