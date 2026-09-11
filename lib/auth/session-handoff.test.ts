import { describe, expect, it, vi } from 'vitest';
import { establishBrowserSession } from './session-handoff';

describe('establishBrowserSession', () => {
  it('rejects an empty token without making a request', async () => {
    const fetcher = vi.fn();
    await expect(establishBrowserSession('  ', fetcher)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts the access token to the server session endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(establishBrowserSession('access-token', fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'access-token' }),
    });
  });

  it('fails closed on a rejected server handoff', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(establishBrowserSession('access-token', fetcher)).resolves.toBe(false);
  });
});
