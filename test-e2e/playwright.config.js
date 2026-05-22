const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  // Phase E v4: globalSetup logs in once and writes auth state to
  // playwright/.auth/user.json. Specs that need authenticated screens
  // opt in via test.use({ storageState: ... }).
  globalSetup: require.resolve('./global-setup.js'),
  use: {
    // BASE_URL > ATS_BASE_URL > prod fallback (Phase A.4 alias fix).
    baseURL: process.env.BASE_URL || process.env.ATS_BASE_URL || 'https://ats.rajasekarselvam.com',
    headless: true,
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  reporter: process.env.CI ? 'github' : 'list',
});
