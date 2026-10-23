import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// In the Claude Code sandbox a Chromium build is preinstalled; elsewhere Playwright downloads its own.
const sandboxChromium = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const launchOptions = existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', launchOptions },
  webServer: [
    {
      command: 'npm run dev -- --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      env: {
        APP_PASSCODE: 'test-passcode',
        MAX_CALLS_PER_SESSION: '150',
        RATE_LIMIT_PER_MIN: '1000',
      },
    },
    {
      // Production build with the production security headers (no /api: the CSP is what is tested).
      command: 'npx vite build --logLevel error && npx vite preview --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'prod-build',
      testMatch: /prod/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'desktop',
      testIgnore: /prod/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet',
      testIgnore: /prod/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'phone',
      testMatch: /layout|smoke/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 400, height: 800 } },
    },
  ],
});
