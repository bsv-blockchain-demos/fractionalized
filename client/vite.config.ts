import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../shared'),
      // See src/lib/nodeCryptoStub.ts. First-party node: imports are still blocked by
      // _test/ModuleBoundaries.test.ts, so this cannot mask a real leak from our own code.
      'node:crypto': path.resolve(__dirname, 'src/lib/nodeCryptoStub.ts'),
    },
  },
  server: {
    port: 5173,
    // REQUIRED: without strictPort the dev server silently moves to 5174 when
    // 5173 is busy, which no longer matches ALLOWED_ORIGINS → CORS failures
    // that look like auth bugs.
    strictPort: true,
  },
  css: {
    // @tailwindcss/vite needs no postcss config. This inline (empty) one wins over
    // Vite's upward file search, so a stray postcss config at the repo root can't
    // break the client build.
    postcss: {},
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
