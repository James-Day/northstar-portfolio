import { createClient } from '@supabase/supabase-js';

type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

export function createPublicSupabaseClient(config: PublicSupabaseConfig) {
  if (!config.url.startsWith('https://')) throw new Error('Supabase URL must use HTTPS.');
  if (!config.anonKey) throw new Error('A Supabase anonymous key is required.');
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
