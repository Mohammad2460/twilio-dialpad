import { defineConfig } from 'vitest/config';

// Scoped so the runner doesn't load the extension's root Vite/CRX config, and
// the dep optimizer is off (it stalls on the @supabase import chain pulled in
// transitively by lib/credits — the tests only exercise pure cost math).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    deps: { optimizer: { ssr: { enabled: false }, web: { enabled: false } } },
  },
});
