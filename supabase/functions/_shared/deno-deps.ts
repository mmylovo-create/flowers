// Wiring for Supabase Edge Functions (Deno runtime).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { ServerDeps } from './server.ts';
import { TelegramClient } from './server.ts';
import { anthropicLlm } from './assistant.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

export function denoDeps(): ServerDeps {
  const env = (k: string) => Deno.env.get(k) ?? '';
  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = env('TELEGRAM_BOT_TOKEN');
  return {
    db: supabase,
    telegram: token ? new TelegramClient(token) : null,
    siteUrl: env('SITE_URL'),
    botUsername: env('TELEGRAM_BOT_USERNAME'),
    webhookSecret: env('TELEGRAM_WEBHOOK_SECRET'),
    uploadMedia: async (shopId, path, bytes, contentType) => {
      const full = `${shopId}/${path}`;
      const { error } = await supabase.storage.from('shop-media').upload(full, bytes, { contentType, upsert: false });
      if (error) throw error;
      return supabase.storage.from('shop-media').getPublicUrl(full).data.publicUrl;
    },
    assistantLlm: env('ANTHROPIC_API_KEY') ? anthropicLlm(env('ANTHROPIC_API_KEY'), env('ASSISTANT_MODEL') || 'claude-haiku-4-5') : undefined,
    log: (...a) => console.error(...a),
  };
}
