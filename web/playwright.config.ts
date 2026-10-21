import { defineConfig } from '@playwright/test';

// Runs against a server that is already going (mix phx.server), with a fresh
// data folder: FAMILY_DATA_DIR=/tmp/family-e2e mix phx.server
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  // The accessibility check looks at the family the story leaves behind.
  projects: [
    { name: 'family', testMatch: 'family.spec.ts' },
    { name: 'a11y', testMatch: 'a11y.spec.ts', dependencies: ['family'] },
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4000',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      // A pretend camera and microphone for the video call test.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
});
