// Local-only signing keys for the stand-in backend. Never used in production.
import { createHmac } from 'node:crypto';

const SECRET = 'local-dev-jwt-secret-not-for-production';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signJwt(payload: Record<string, unknown>): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  if (createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null;
  return p;
}

export const ANON_KEY = signJwt({ role: 'anon', iss: 'local' });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'local' });
export const WEBHOOK_SECRET = 'local-webhook-secret';
export const BACKEND_URL = `http://127.0.0.1:${process.env.BACKEND_PORT ?? 54321}`;
