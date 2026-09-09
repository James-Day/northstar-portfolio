import { describe, expect, it } from 'vitest';
import { createPublicSupabaseClient } from '@/services/supabase/client';

describe('public Supabase client', () => {
  it('allows an HTTP endpoint only for local development', () => {
    expect(() =>
      createPublicSupabaseClient({
        url: 'http://127.0.0.1:54321',
        anonKey: 'local-public-key',
      }),
    ).not.toThrow();
  });

  it('requires HTTPS for deployed Supabase endpoints', () => {
    expect(() =>
      createPublicSupabaseClient({
        url: 'http://project.example.test',
        anonKey: 'public-key',
      }),
    ).toThrow('Supabase URL must use HTTPS outside local development.');
  });
});
