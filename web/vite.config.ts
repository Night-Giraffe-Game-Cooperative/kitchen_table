import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build` writes the app into the Phoenix server, which serves it.
// `npm run dev` serves it on :5173 and passes the API through to Phoenix on :4000
// (or wherever FAMILY_SERVER points).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const server = env.FAMILY_SERVER ?? 'http://localhost:4000';
// The calendar tests run in the family's own time zone, clocks changing and all.
env.TZ ??= 'Europe/London';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/priv/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    proxy: {
      '/api': server,
      '/media': server,
      '/socket': { target: server.replace('http', 'ws'), ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
} as never);
