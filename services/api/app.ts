import { Hono } from 'hono';

export type ApiBindings = {
  APP_ENV?: 'development' | 'staging' | 'production';
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

export function createApi() {
  const api = new Hono<{ Bindings: ApiBindings }>();

  api.get('/health', (context) =>
    context.json({
      status: 'ok',
      service: 'northstar-api',
      environment: context.env.APP_ENV ?? 'development',
    }),
  );

  return api;
}

export const api = createApi();
