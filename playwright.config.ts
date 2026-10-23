import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// In the Claude Code sandbox a Chromium build is preinstalled; elsewhere Playwright downloads its own.
const sandboxChromium = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const launchOptions = existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', launchOptions },
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    env: { APP_PASSCODE: 'test-passcode', MAX_CALLS_PER_SESSION: '150' },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 400, height: 800 } } },
  ],
});
