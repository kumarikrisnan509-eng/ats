// zerodha-auto-login.js — INTENTIONALLY EMPTY.
//
// Earlier draft: ran Playwright inside the container. That bloated the image
// (Chromium ~600MB) and made the deploy health check time out.
//
// Current architecture: auto-login runs on the HOST (deploy/scripts/auto-login-host.js)
// using node + playwright apt-installed on Ubuntu. The container only exposes:
//   GET  /api/brokers/zerodha/auto-login/bundle    — serve creds to host
//   POST /api/brokers/zerodha/auto-login/exchange  — receive request_token from host
//
// Kept as a placeholder so older imports don't break during the transition.
module.exports = {};
