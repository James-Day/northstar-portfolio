import { describe, expect, it } from 'vitest';
import { buildAuthRedirectUrl, parseOrigin, readAuthRedirectOrigins } from '@/lib/auth/redirects';

describe('auth redirect allowlist', () => {
  it('builds only fixed callback and recovery destinations', () => {
    const allowed = ['https://app.example.com'];
    expect(buildAuthRedirectUrl('https://app.example.com', 'callback', allowed)).toBe('https://app.example.com/auth/callback');
    expect(buildAuthRedirectUrl('https://app.example.com/', 'recovery', allowed)).toBe('https://app.example.com/auth/recovery');
  });

  it('rejects an origin outside the configured allowlist', () => {
    expect(() => buildAuthRedirectUrl('https://evil.example', 'callback', ['https://app.example.com']))
      .toThrow('not configured');
    expect(() => buildAuthRedirectUrl('https://app.example.com.evil.test', 'callback', ['https://app.example.com']))
      .toThrow('not configured');
    expect(() => buildAuthRedirectUrl('https://app.example.com:444', 'callback', ['https://app.example.com']))
      .toThrow('not configured');
  });

  it('rejects non-origin and credential-bearing values', () => {
    expect(() => parseOrigin('javascript:alert(1)')).toThrow('absolute HTTP(S) origin');
    expect(() => parseOrigin('https://user:pass@app.example.com')).toThrow('clean HTTP(S) origin');
    expect(() => parseOrigin('https://app.example.com/login')).toThrow('clean HTTP(S) origin');
  });

  it('uses safe local defaults and requires explicit production origins', () => {
    expect(readAuthRedirectOrigins({ NODE_ENV: 'development' })).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(readAuthRedirectOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('accepts a comma separated production allowlist and normalizes it', () => {
    expect(readAuthRedirectOrigins({ NODE_ENV: 'production', NEXT_PUBLIC_AUTH_ORIGINS: ' https://app.example.com/,https://www.example.com ' }))
      .toEqual(['https://app.example.com', 'https://www.example.com']);
  });
});
