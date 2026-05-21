const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    // Resolution order: BASE_URL (Phase A test:local helper), ATS_BASE_URL
    // (legacy CI variable), then prod fallback. Phase A.1 fix: prior to this
    // line, only ATS_BASE_URL was read, so `npm run test:local` ran against
    // prod despite setting BASE_URL=http://localhost:8080.
    baseURL: process.env.BASE_URL || process.env.ATS_BASE_URL || 'https://ats.rajasekarselvam.com',
    headless: true,
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  reporter: process.env.CI ? 'github' : 'list',
});
