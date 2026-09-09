export type RuntimeConfig = {
  environment: 'development' | 'test' | 'production';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  marketstackApiKey?: string;
};

function optional(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

export function readRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const environment = (optional(env, 'NODE_ENV') ?? 'development') as RuntimeConfig['environment'];
  if (!['development', 'test', 'production'].includes(environment)) throw new Error('NODE_ENV must be development, test, or production.');
  const config = {
    environment,
    supabaseUrl: optional(env, 'SUPABASE_URL'),
    supabaseAnonKey: optional(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    marketstackApiKey: optional(env, 'MARKETSTACK_API_KEY'),
  };
  if (environment === 'production' && (!config.supabaseUrl || !config.supabaseAnonKey)) throw new Error('Production requires Supabase URL and public anonymous key.');
  return config;
}
