import { defineConfig } from 'vitest/config';
import { join } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@domain': join(import.meta.dirname, 'supabase/functions/_shared/domain/index.ts'),
      '@server': join(import.meta.dirname, 'supabase/functions/_shared'),
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 },
});
