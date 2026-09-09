import { Hono } from 'hono';
import {
  SessionConfigurationError,
  type AuthenticatedUser,
  verifySupabaseSession,
} from '@/services/auth/server-session';
import { validateCreatePortfolioAccount, type AccountsRepository } from '@/services/accounts/accounts';
import { SupabaseAccountsRepository } from '@/services/supabase/accounts-repository';
import { stageRobinhoodImport } from '@/services/ingestion/staging';
import { SupabaseImportsRepository, type ImportsRepository } from '@/services/supabase/imports-repository';

export type ApiBindings = {
  APP_ENV?: 'development' | 'staging' | 'production';
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

export type ApiDependencies = {
  verifySession?: (request: Request, bindings: ApiBindings) => Promise<AuthenticatedUser | undefined>;
  accountsRepository?: AccountsRepository;
  importsRepository?: ImportsRepository;
};

export function createApi(dependencies: ApiDependencies = {}) {
  const api = new Hono<{ Bindings: ApiBindings }>();
  const verifySession = dependencies.verifySession ?? ((request, bindings) =>
    verifySupabaseSession(request, {
      supabaseUrl: bindings.SUPABASE_URL,
      supabaseAnonKey: bindings.SUPABASE_ANON_KEY,
    }));
  const accountsRepository = dependencies.accountsRepository;
  const importsRepository = dependencies.importsRepository;

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

  api.get('/v1/accounts', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const repository = accountsRepository ?? createAccountsRepository(context.env);
    return context.json({ accounts: await repository.list(authenticated.user.id, authenticated.accessToken) });
  });

  api.post('/v1/accounts', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const input = validateCreatePortfolioAccount(await context.req.json());
    const repository = accountsRepository ?? createAccountsRepository(context.env);
    const account = await repository.create(authenticated.user.id, authenticated.accessToken, input);
    return context.json({ account }, 201);
  });

  api.post('/v1/accounts/:accountId/import-preview', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    const account = await accounts.get(authenticated.user.id, authenticated.accessToken, accountId);
    if (!account) return context.json({ error: 'not_found' }, 404);
    const contentType = context.req.header('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('text/csv')) return context.json({ error: 'unsupported_media_type' }, 415);
    const staged = await stageRobinhoodImport(accountId, await context.req.text());
    const imports = importsRepository ?? createImportsRepository(context.env);
    const duplicateFile = await imports.hasFileHash(accountId, authenticated.accessToken, staged.fileSha256);
    return context.json({ import: { ...staged, duplicateFile } });
  });

  return api;
}

export const api = createApi();

async function requireSession(
  request: Request,
  bindings: ApiBindings,
  verifySession: (request: Request, bindings: ApiBindings) => Promise<AuthenticatedUser | undefined>,
): Promise<{ user: AuthenticatedUser; accessToken: string } | Response> {
  try {
    const accessToken = readBearerToken(request);
    if (!accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const user = await verifySession(request, bindings);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    return { user, accessToken };
  } catch (error) {
    if (error instanceof SessionConfigurationError) return Response.json({ error: 'service_unavailable' }, { status: 503 });
    throw error;
  }
}

function createAccountsRepository(bindings: ApiBindings): AccountsRepository {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) throw new SessionConfigurationError();
  return new SupabaseAccountsRepository({ supabaseUrl: bindings.SUPABASE_URL, supabaseAnonKey: bindings.SUPABASE_ANON_KEY });
}

function createImportsRepository(bindings: ApiBindings): ImportsRepository {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) throw new SessionConfigurationError();
  return new SupabaseImportsRepository({ supabaseUrl: bindings.SUPABASE_URL, supabaseAnonKey: bindings.SUPABASE_ANON_KEY });
}

function readBearerToken(request: Request): string | undefined {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
