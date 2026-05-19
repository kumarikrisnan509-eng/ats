// T-227 (CODE-AUDIT F.5 M1.4 piece 7b): /ws WebSocketServer ctor +
// connection handler.
//
// This is the highest-risk M1.4 extract per the handoff doc
// (M1.4-PIECE-6-7-HANDOFF.md): real-time hot path, shared mutable state
// (wsClients Set), upstream subscription lifecycle, and the T-198b
// verifyClient Origin check all move together.
//
// What moves here:
//   - new WebSocketServer({ server, path: '/ws', verifyClient }) ctor
//   - wss.on('connection', ...) handler (auth, welcome packet,
//     subscribe/unsubscribe message handling, per-client ws.symbolSet)
//
// What stays in server.js:
//   - wsClients (Set<WebSocket>) -- shared with the metrics gauge,
//     alerts broadcast, kill-switch broadcast at L1406/L1461/L3221.
//     Mutations on the Set are visible across module boundaries because
//     Sets are objects; we pass the reference.
//   - MAX_WS_CLIENTS, DEFAULT_SYMBOLS, KILL_SWITCH, LIVE_TRADING
//     (config consts -- pass by value)
//   - CSRF_ALLOWED_ORIGINS (Set, used by verifyClient -- pass by ref)
//   - readSessionCookie, audit (function declarations, hoisted, pass
//     by value)
//
// Mutable singletons (db, broker, watchlist) passed as getters per
// T-228 / 6b convention.

'use strict';

const { WebSocketServer } = require('ws');

function mountWs(server, deps) {
  const {
    wsClients,
    MAX_WS_CLIENTS,
    DEFAULT_SYMBOLS,
    KILL_SWITCH,
    LIVE_TRADING,
    CSRF_ALLOWED_ORIGINS,
    audit,
    readSessionCookie,
    getDb,
    getBroker,
    getWatchlist,
  } = deps;

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, cb) => {
      const origin = (info.origin || (info.req && info.req.headers && info.req.headers['origin']) || '').toString();
      // T-198b: allow three benign shapes; reject only the explicit
      // cross-origin browser attack.
      //
      // (1) No Origin header (empty)    -> ALLOW. curl/native WS, server-to-
      //                                     server monitors. Cannot ride a user's
      //                                     cookie because they can't acquire one.
      // (2) Origin: 'null'              -> ALLOW. Standard browser opaque-origin
      //                                     value (about:blank, sandboxed iframes,
      //                                     data: URLs, sandboxed Playwright
      //                                     contexts). SameSite=Lax cookies are
      //                                     NOT sent on WS upgrades from these
      //                                     contexts, so even if an attacker
      //                                     hosted a sandboxed page, the user's
      //                                     session cookie wouldn't ride the WS
      //                                     upgrade -> the connection lands
      //                                     anonymous -> the auth gate at L5117
      //                                     treats it as a public welcome.
      // (3) Origin in CSRF_ALLOWED_ORIGINS -> ALLOW. Same-origin browser.
      // (4) any other explicit Origin    -> REJECT. Browser cross-origin attack.
      if (!origin || origin === 'null') return cb(true);
      if (CSRF_ALLOWED_ORIGINS.has(origin)) return cb(true);
      audit('ws.upgrade.reject', { reason: 'origin_not_allowed', origin, ip: info.req && info.req.socket && info.req.socket.remoteAddress });
      return cb(false, 403, 'cross_origin_rejected');
    },
  });

  wss.on('connection', (ws, req) => {
    const db = getDb();
    const broker = getBroker();
    const watchlist = getWatchlist();
    if (wsClients.size > MAX_WS_CLIENTS) { ws.close(1013, 'too many clients'); return; }
    wsClients.add(ws);

    // T-130 (Tier 75 Phase 1): WebSocket auth-on-connect.
    //
    // Read the ats.sid cookie from the upgrade-request headers, verify the HMAC,
    // and look up the session row. Stash userId + userEmail on the ws instance
    // so future per-user filtering (Tier 75 Phase 2) can scope tick broadcasts.
    //
    // This phase does NOT change broadcast behavior — every connected client still
    // gets every tick. We're only adding the identification plumbing so the
    // filtering change in Phase 2 is mechanically small.
    //
    // Failures (no cookie, bad HMAC, expired session, sessions module unavailable)
    // are non-fatal: ws.userId stays null and the connection proceeds as anonymous.
    ws.userId = null;
    ws.userEmail = null;
    try {
      const sid = readSessionCookie(req);
      if (sid && db && db.sessions && typeof db.sessions.get === 'function') {
        const row = db.sessions.get(sid);
        if (row && row.user_id) {
          const now = Date.now();
          const exp = row.expires_at ? Number(row.expires_at) : 0;
          if (!exp || exp > now) {
            ws.userId = row.user_id;
            // Try to enrich with email — best-effort, the welcome packet can
            // still go out if this fails.
            try {
              if (db.users && typeof db.users.byId === 'function') {
                const u = db.users.byId(row.user_id);
                if (u && u.email) ws.userEmail = u.email;
              }
            } catch (e) { console.warn('[server] swallowed:', e && e.message); }
          }
        }
      }
    } catch (e) {
      console.warn('[ws] auth lookup error (continuing anonymous):', e && e.message);
    }

    audit('ws.connect', {
      ip: req.socket.remoteAddress,
      total: wsClients.size,
      userId: ws.userId,
      authed: !!ws.userId,
    });

    // Build the effective subscribe set: defaults + persisted watchlist (deduped).
    //
    // T-131 (Tier 75 Phase 2): when ws.userId is set (authed via T-130), prefer
    // the user's DB-backed watchlist (db.watchlist.list(userId)) over the legacy
    // file-singleton. Anonymous WS clients still see the singleton list so the
    // pre-login app shell continues to render the default-strip.
    let userSaved = [];
    try {
      if (ws.userId && db && db.watchlist && typeof db.watchlist.list === 'function') {
        const rows = db.watchlist.list(ws.userId) || [];
        userSaved = rows.map(r => (r && r.symbol) ? r.symbol : (typeof r === 'string' ? r : null)).filter(Boolean);
      } else if (watchlist) {
        userSaved = watchlist.list() || [];
      }
    } catch (e) {
      console.warn('[ws] watchlist load error (falling back to defaults):', e && e.message);
      userSaved = [];
    }
    const merged = Array.from(new Set([...DEFAULT_SYMBOLS, ...userSaved]));

    // T-131: stamp the per-WS symbol set used by the fanout loop.
    ws.symbolSet = new Set(merged);

    ws.send(JSON.stringify({
      type: 'welcome',
      broker: broker.name,
      killSwitch: KILL_SWITCH,
      liveTrading: LIVE_TRADING,
      symbols: merged,
      defaultSymbols: DEFAULT_SYMBOLS,
      watchlist: userSaved,
      // T-130: surface auth state so the frontend can confirm the session was
      // recognized on the WS handshake (independent of the HTTP /api/me/identity
      // round-trip). userEmail may be null even when userId is set.
      authed: !!ws.userId,
      userId: ws.userId,
      userEmail: ws.userEmail,
      note: broker.name === 'mock'
        ? 'Simulated ticks for UI only. Not a real market feed.'
        : 'Live ticks via Kite Ticker. Subject to market hours.',
    }));

    // T99-T44: include current upstream state in welcome so the frontend knows
    // immediately whether to render the 'stalled' / 'frozen' banner without
    // waiting up to 10s for the next broadcast.
    try {
      const bh = (typeof broker.health === 'function') ? broker.health() : {};
      ws.send(JSON.stringify({
        type: 'upstream_state',
        connected: !!bh.connected,
        stalledOnToken: !!bh.stalledOnToken,
        tickStale: !!bh.tickStale,
      }));
    } catch (_) { /* welcome must not throw */ }

    // Auto-subscribe so this client gets ticks immediately during market hours.
    if (typeof broker.ensureSubscribed === 'function') {
      broker.ensureSubscribed(merged).catch((err) =>
        console.error('[ws] auto-subscribe failed:', err && err.message)
      );
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      }

      if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
        const symbols = msg.symbols.filter(s => typeof s === 'string').slice(0, 200);
        // T-131: extend this client's symbol set so the fanout loop forwards
        // these ticks even before upstream confirms. ensureSubscribed below
        // makes sure upstream is also subscribed (idempotent).
        if (ws.symbolSet) {
          for (const s of symbols) ws.symbolSet.add(s);
        }
        if (typeof broker.ensureSubscribed === 'function') {
          broker.ensureSubscribed(symbols)
            .then((result) => {
              audit('ws.subscribe', { count: symbols.length, userId: ws.userId, ...result });
              ws.send(JSON.stringify({ type: 'subscribed', symbols, ...result }));
            })
            .catch((err) => {
              ws.send(JSON.stringify({ type: 'error', reason: err.message }));
            });
        } else {
          ws.send(JSON.stringify({ type: 'subscribed', symbols, note: 'symbolSet updated locally; broker has no ensureSubscribed' }));
        }
        return;
      }

      // T-131: unsubscribe — shrink this client's symbol set. We deliberately
      // do NOT unsubscribe upstream (other clients may still want these ticks);
      // the per-WS filter handles isolation at zero upstream cost.
      if (msg.type === 'unsubscribe' && Array.isArray(msg.symbols)) {
        const symbols = msg.symbols.filter(s => typeof s === 'string').slice(0, 200);
        if (ws.symbolSet) {
          for (const s of symbols) ws.symbolSet.delete(s);
        }
        audit('ws.unsubscribe', { count: symbols.length, userId: ws.userId });
        ws.send(JSON.stringify({ type: 'unsubscribed', symbols }));
        return;
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      audit('ws.disconnect', { total: wsClients.size });
    });
  });

  return wss;
}

module.exports = { mountWs };
