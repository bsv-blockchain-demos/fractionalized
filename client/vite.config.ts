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
    // Inline (empty) postcss config wins over Vite's upward file search, which
    // otherwise finds the root's Next-era postcss.config.mjs (@tailwindcss/postcss,
    // not a valid Vite/postcss plugin shape) and breaks the build. @tailwindcss/vite
    // needs no postcss config of its own.
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
