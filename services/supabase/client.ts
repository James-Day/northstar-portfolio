import { createClient } from '@supabase/supabase-js';

type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

export function createPublicSupabaseClient(config: PublicSupabaseConfig) {
  const url = new URL(config.url);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !isLocal) throw new Error('Supabase URL must use HTTPS outside local development.');
  if (!config.anonKey) throw new Error('A Supabase anonymous key is required.');
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
