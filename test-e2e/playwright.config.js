const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.ATS_BASE_URL || 'https://ats.rajasekarselvam.com',
    headless: true,
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  reporter: process.env.CI ? 'github' : 'list',
});
