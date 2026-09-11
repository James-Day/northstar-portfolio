import { describe, expect, it, vi } from 'vitest';
import {
  MemoryRateLimitStore,
  FailClosedRateLimitStore,
  SharedRateLimitStore,
  RequestBodyTooLargeError,
  readJsonRequest,
  readRequestText,
  redactRequestLog,
  requestClientKey,
  requestRateLimit,
} from '@/services/security/request-security';

describe('request security', () => {
  it('fails closed when a production deployment has no shared counter', () => {
    expect(new FailClosedRateLimitStore().consume('ip', 0, 30, 60_000)).toEqual({
      allowed: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it('allows a bounded burst and returns a retry window after exhaustion', () => {
    const store = new MemoryRateLimitStore();
    expect(store.consume('ip', 0, 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(store.consume('ip', 1, 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(store.consume('ip', 2, 2, 60_000)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(store.consume('ip', 60_000, 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it('adapts an atomic shared counter for multi-instance deployments', async () => {
    const increment = vi.fn().mockResolvedValue({ windowStartedAt: 1_000, count: 3 });
    const store = new SharedRateLimitStore({ increment });
    await expect(store.consume('ip', 1_500, 2, 60_000)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 60,
    });
    expect(increment).toHaveBeenCalledWith('ip', 1_500, 60_000);
  });

  it('uses trusted edge identity and classifies writes more tightly', () => {
    const request = new Request('https://api.test/v1/accounts', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '198.51.100.4',
      },
    });
    expect(requestClientKey(request)).toBe('203.0.113.9');
    expect(requestRateLimit('/v1/accounts', 'POST')).toEqual({
      limit: 30,
      windowMs: 60_000,
    });
  });

  it('removes query strings and never carries credential headers into logs', () => {
    const output = redactRequestLog({
      requestId: 'req',
      method: 'get',
      path: '/v1/me?token=secret',
      status: 200,
      userId: 'user',
    });
    expect(output).toEqual({
      requestId: 'req',
      method: 'GET',
      path: '/v1/me',
      status: 200,
      userId: 'user',
    });
    expect(JSON.stringify(output)).not.toContain('secret');
  });

  it('enforces body limits for both declared and chunked requests', async () => {
    await expect(
      readRequestText(
        new Request('https://api.test', { method: 'POST', body: '12345' }),
        4,
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.close();
      },
    });
    await expect(
      readRequestText(
        new Request('https://api.test', {
          method: 'POST',
          body: stream,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' }),
        4,
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('parses bounded JSON and reports malformed bodies without exposing parser details', async () => {
    await expect(
      readJsonRequest(
        new Request('https://api.test', {
          method: 'POST',
          body: JSON.stringify({ ok: true }),
        }),
        1024,
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      readJsonRequest(
        new Request('https://api.test', { method: 'POST', body: '{oops' }),
        1024,
      ),
    ).rejects.toThrow('valid JSON');
  });
});
