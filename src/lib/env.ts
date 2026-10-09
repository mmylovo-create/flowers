export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
// The in-chat preview build (VITE_PREVIEW=1) cannot reach the network, so it always runs as a sample.
export const HAS_BACKEND = import.meta.env.VITE_PREVIEW !== '1' && Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
