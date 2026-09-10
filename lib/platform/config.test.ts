import { describe, expect, it } from 'vitest';
import { readPublicApiConfig, readPublicSupabaseConfig, readRuntimeConfig } from '@/lib/platform/config';

describe('runtime configuration', () => {
  it('uses browser-prefixed Supabase configuration when it is present', () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' };
    expect(readPublicSupabaseConfig(env)).toEqual({ url: 'https://project.supabase.co', anonKey: 'anon' });
  });

  it('allows local server routes to pass only the anonymous Supabase configuration to the browser', () => {
    const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-exposed' };
    expect(readPublicSupabaseConfig(env)).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'local-anon' });
    expect(readRuntimeConfig(env)).toMatchObject({ supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'local-anon' });
  });

  it('does not produce an incomplete public configuration', () => {
    expect(readPublicSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co' })).toBeUndefined();
  });

  it('uses an explicit public API origin and never guesses localhost in production', () => {
    expect(readPublicApiConfig({ NEXT_PUBLIC_API_URL: 'https://api.example.com/' })).toEqual({ baseUrl: 'https://api.example.com' });
    expect(readPublicApiConfig({ NODE_ENV: 'production' })).toBeUndefined();
  });
});
