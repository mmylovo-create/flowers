// pnpm dev:local — local backend (database, server functions, fake Telegram) + the web app.
import { spawn } from 'node:child_process';
import { startBackend, ANON_KEY, OWNER_PASSWORD } from './backend.ts';

const b = await startBackend();
console.log(`\nBackend: ${b.base}  (owner password: ${OWNER_PASSWORD})`);
const vite = spawn('pnpm', ['dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: b.base, VITE_SUPABASE_ANON_KEY: ANON_KEY, VITE_TELEGRAM_BOT: 'flowers_local_bot' },
});
const stop = () => { vite.kill(); void b.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', (code) => { void b.close().then(() => process.exit(code ?? 0)); });
