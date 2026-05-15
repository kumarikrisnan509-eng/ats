#!/usr/bin/env node
// migrate-from-json.js -- Tier 54: one-time CLI to import existing JSON-file
// state into the new SQLite tables under the first admin user_id.
//
// Usage on the VM:
//   docker exec -it ats-backend node migrate-from-json.js [admin_email]
//
// What it does:
//   1. Find the target admin user (default: first user OR the email passed in)
//   2. Read existing /var/lib/ats/tokens/_*.json files
//   3. INSERT INTO the per-user SQLite tables under admin.id
//   4. Print a summary
//
// Idempotent: every INSERT uses ON CONFLICT DO NOTHING or DELETE+INSERT.

'use strict';

const fs = require('fs');
const path = require('path');
const { open } = require('./db');

const TOKENS_DIR = process.env.TOKENS_DIR || '/var/lib/ats/tokens';

function readJson(file) {
  const p = path.join(TOKENS_DIR, file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`!! parse ${file}: ${e.message}`); return null; }
}

async function main() {
  const db = open();
  console.log(`migrate: SQLite at ${require('./db').DEFAULT_PATH}, ${db.users.count()} users`);

  const targetEmail = process.argv[2];
  let admin;
  if (targetEmail) {
    admin = db.users.byEmail(targetEmail);
    if (!admin) { console.error(`!! no user with email ${targetEmail}`); process.exit(2); }
  } else {
    admin = db._conn.prepare('SELECT * FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1').get();
    if (!admin) { console.error('!! no admin user. Create one via /api/auth/signup first.'); process.exit(2); }
  }
  console.log(`migrate: target user id=${admin.id} email=${admin.email}`);

  let total = 0;

  // ---- Watchlist ----
  const wl = readJson('_watchlist.json');
  if (wl && Array.isArray(wl.symbols)) {
    for (const s of wl.symbols) db.watchlist.add(admin.id, String(s).toUpperCase());
    console.log(`  watchlist: ${wl.symbols.length} symbols`);
    total += wl.symbols.length;
  }

  // ---- Alerts ----
  const al = readJson('_alerts.json');
  if (al && Array.isArray(al.alerts)) {
    for (const a of al.alerts) {
      try {
        db.alerts.add(
          admin.id,
          String(a.symbol).toUpperCase(),
          a.operator || a.op || 'gte',
          Number(a.triggerPrice || a.threshold || a.price),
          a.channel || 'telegram',
        );
      } catch (e) { console.error(`  alert insert failed: ${e.message}`); }
    }
    console.log(`  alerts: ${al.alerts.length}`);
    total += al.alerts.length;
  }

  // ---- Paper state ----
  const paper = readJson('_paper.json');
  if (paper && paper.state) {
    db.paper.setState({
      user_id: admin.id,
      tier:    paper.state.tier || '10L',
      cash:    Number(paper.state.cash || 1000000),
      initial_capital: Number(paper.state.initialCapital || 1000000),
      realized_pnl: Number(paper.state.realizedPnl || 0),
    });
    console.log(`  paper state: tier=${paper.state.tier} cash=₹${paper.state.cash}`);
  }
  // Paper orders
  if (paper && Array.isArray(paper.orders)) {
    for (const o of paper.orders) {
      try {
        db.paper.placeOrder({
          user_id: admin.id,
          client_order_id: o.id || o.clientOrderId || String(Date.now()),
          strategy_tag: o.strategy || null,
          symbol: o.s || o.symbol,
          side: o.side,
          qty: Number(o.qty || o.quantity),
          order_type: o.orderType || 'MARKET',
          product: o.product || 'CNC',
          req_price: Number(o.req || o.reqPrice || 0),
          fill_price: Number(o.fill || o.fillPrice || 0),
          slippage: Number(o.slip || o.slippage || 0),
          status: o.st || o.status || 'filled',
          filled_at: o.t || o.filledAt || null,
        });
      } catch (e) { console.error(`  paper order failed: ${e.message}`); }
    }
    console.log(`  paper orders: ${paper.orders.length}`);
    total += paper.orders.length;
  }

  // ---- P&L ----
  const pnl = readJson('_pnl.json');
  if (pnl && Array.isArray(pnl.rows)) {
    for (const r of pnl.rows) {
      try {
        db.pnl.upsertDay({
          user_id: admin.id,
          date: r.date || r.d,
          realized_pnl: Number(r.realizedPnl || 0),
          unrealized_pnl: Number(r.unrealizedPnl || 0),
          equity: Number(r.equity || 0),
          trades: Number(r.trades || 0),
        });
      } catch (e) { console.error(`  pnl row failed: ${e.message}`); }
    }
    console.log(`  pnl rows: ${pnl.rows.length}`);
    total += pnl.rows.length;
  }

  // ---- Autorun ----
  const ar = readJson('_autorun.json');
  if (ar && ar.config) {
    db.autorun.upsert({
      user_id: admin.id,
      enabled: ar.config.enabled ? 1 : 0,
      strategy: ar.config.strategy || null,
      symbol: ar.config.symbol || null,
      qty: Number(ar.config.qty) || 1,
      interval: ar.config.interval || 'day',
      interval_minutes: Number(ar.config.intervalMinutes) || 60,
      candle_lookback_days: Number(ar.config.candleLookbackDays) || 60,
    });
    console.log(`  autorun: strategy=${ar.config.strategy} enabled=${ar.config.enabled}`);
  }
  if (ar && Array.isArray(ar.history)) {
    for (const h of ar.history.slice(-100)) {
      try { db.autorun.addHistory(admin.id, h.strategy, h.symbol, h.signal, h.action, h.note); }
      catch (e) { /* ignore individual row failures */ }
    }
    console.log(`  autorun history: ${Math.min(100, ar.history.length)} rows`);
  }

  console.log(`\nmigrate: done. ~${total} rows imported into user ${admin.id} (${admin.email}).`);
  console.log(`Verify: docker exec -it ats-backend sqlite3 /var/lib/ats/ats.db 'SELECT COUNT(*) FROM watchlist;'`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
