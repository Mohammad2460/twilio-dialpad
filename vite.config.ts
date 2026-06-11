import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      // sidepanel + options come from the manifest (side_panel / options_page) —
      // @crxjs derives them. Declaring them here too collides and hangs the build.
      // offscreen.html is NOT a manifest field (created at runtime), so it stays.
      input: {
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
});
