import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  outputDir: './test-results/browser',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173', headless: true,
    launchOptions: process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {} },
  webServer: process.env.BASE_URL ? undefined : { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
