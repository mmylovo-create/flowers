// Public server function: create/cancel orders, the shop assistant, notification delivery.
import { createApiHandler } from '../_shared/server.ts';
import { denoDeps } from '../_shared/deno-deps.ts';

declare const Deno: { serve(h: (r: Request) => Response | Promise<Response>): void };
Deno.serve(createApiHandler(denoDeps()));
