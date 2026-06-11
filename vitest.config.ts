import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Dedicated test config. We do NOT load the @crxjs/vite-plugin here — its `config`
// hook resolves the extension manifest (globbing icons/web-accessible resources)
// and throws under vitest, which has no build context. Unit tests only need the
// path aliases + the happy-dom environment.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    // 'node' (not happy-dom): these are pure-logic unit tests, and happy-dom
    // hangs vitest 2.x on teardown in this environment. Tests mock chrome.* directly.
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
});
