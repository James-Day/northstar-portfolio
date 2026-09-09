import { Hono } from 'hono';
import {
  SessionConfigurationError,
  type AuthenticatedUser,
  verifySupabaseSession,
} from '@/services/auth/server-session';

export type ApiBindings = {
  APP_ENV?: 'development' | 'staging' | 'production';
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

export type ApiDependencies = {
  verifySession?: (request: Request, bindings: ApiBindings) => Promise<AuthenticatedUser | undefined>;
};

export function createApi(dependencies: ApiDependencies = {}) {
  const api = new Hono<{ Bindings: ApiBindings }>();
  const verifySession = dependencies.verifySession ?? ((request, bindings) =>
    verifySupabaseSession(request, {
      supabaseUrl: bindings.SUPABASE_URL,
      supabaseAnonKey: bindings.SUPABASE_ANON_KEY,
    }));

  api.get('/health', (context) =>
    context.json({
      status: 'ok',
      service: 'northstar-api',
      environment: context.env.APP_ENV ?? 'development',
    }),
  );

  api.get('/v1/me', async (context) => {
    try {
      const user = await verifySession(context.req.raw, context.env);
      if (!user) return context.json({ error: 'unauthorized' }, 401);
      return context.json({ user });
    } catch (error) {
      if (error instanceof SessionConfigurationError) {
        return context.json({ error: 'service_unavailable' }, 503);
      }
      throw error;
    }
  });

  return api;
}

export const api = createApi();
