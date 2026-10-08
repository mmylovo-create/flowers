import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HAS_BACKEND, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!HAS_BACKEND) throw new Error('Backend is not configured');
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'flowers-owner-session' },
  });
  return client;
}
