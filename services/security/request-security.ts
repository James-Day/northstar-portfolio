export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitStore = {
  consume(key: string, now: number, limit: number, windowMs: number): RateLimitDecision;
};

type Counter = { windowStartedAt: number; count: number };

/**
 * Small edge-safe fixed-window limiter. Production deployments should provide
 * a shared Durable Object/KV-backed implementation; this fallback still
 * protects a warm Worker instance and keeps local development deterministic.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly maxKeys = 10_000) {}

  consume(key: string, now: number, limit: number, windowMs: number): RateLimitDecision {
    const current = this.counters.get(key);
    const counter = !current || now - current.windowStartedAt >= windowMs
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
  if (path === "/health") return { limit: 120, windowMs: 60_000 };
  if (method === "POST" || method === "PUT" || method === "DELETE") return { limit: 30, windowMs: 60_000 };
  return { limit: 120, windowMs: 60_000 };
}

export function requestClientKey(request: Request): string {
  // Cloudflare supplies this value at the edge. Do not trust arbitrary
  // X-Forwarded-For headers from clients when the Worker is not behind CF.
  return request.headers.get("cf-connecting-ip")?.trim() || "anonymous";
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
    path: input.path.split("?")[0].slice(0, 512),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.userId ? { userId: input.userId.slice(0, 128) } : {}),
  };
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied ? supplied.slice(0, 128) : crypto.randomUUID();
}
