import { defineConfig } from '@playwright/test';

// Two projects:
// - local: full race against a short-race server on this machine. Runs before deploy.
// - live:  read-only smoke against the deployed URL. Runs after deploy; never joins or starts a race.
const LIVE_URL = process.env.BASE_URL || 'https://driver-app.juavan2025.workers.dev';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1, // one shared game room, so tests must not run side by side
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'local',
      use: { baseURL: 'http://localhost:3199' },
    },
    {
      name: 'live',
      grep: /@smoke/,
      use: { baseURL: LIVE_URL },
    },
  ],
  webServer: process.argv.includes('--project=live')
    ? undefined
    : {
        command: 'node e2e/serve.mjs',
        url: 'http://localhost:3199/health',
        reuseExistingServer: false,
        timeout: 15_000,
      },
});
