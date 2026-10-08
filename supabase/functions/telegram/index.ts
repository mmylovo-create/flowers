// Telegram webhook for the owners' bot.
import { createTelegramHandler } from '../_shared/telegram.ts';
import { denoDeps } from '../_shared/deno-deps.ts';

declare const Deno: { serve(h: (r: Request) => Response | Promise<Response>): void };
Deno.serve(createTelegramHandler(denoDeps()));
