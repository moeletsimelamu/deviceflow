import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The end-to-end tests run their own API on another port (see e2e/playwright.config.ts).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Resolve @deviceflow/shared from its TypeScript source during development.
    conditions: ['source', ...defaultClientConditions],
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in development too: the browser talks only to Vite, which
    // forwards API calls. No CORS configuration is needed anywhere.
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
    },
  },
  build: {
    sourcemap: true,
    // Not the default "assets": /assets/<id> is the app's device page, and nginx
    // serves this folder as static files, so a reload there would 404.
    assetsDir: 'static',
  },
});
