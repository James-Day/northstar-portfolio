import { describe, expect, it } from 'vitest';
import { createApi } from '@/services/api/app';

describe('standalone API', () => {
  it('serves a deployment-safe health response without exposing bindings', async () => {
    const app = createApi();
    const response = await app.request('http://api.test/health', undefined, {
      APP_ENV: 'production',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'northstar-api',
      environment: 'production',
    });
  });
});
