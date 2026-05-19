// T-226 (CODE-AUDIT F.5 M1.4 piece 7a): upstream tick fan-out + broker-health
// broadcaster, lifted from server.js.
//
// Lives here:
//   - startBrokerFanout()          (the broker.subscribeTicks subscription)
//   - _lastUpstreamState           (private state for the broadcaster)
//   - _broadcastUpstreamStateIfChanged()  (poll broker.health + alert flips)
//   - the 10s setInterval for the broadcaster
//   - the Telegram notify on stalled/recovered transitions
//
// Stays in server.js:
//   - wsClients (Set<WebSocket>) -- shared across this module + alerts/
//     kill-switch/metrics broadcasters; mutated by ws.on('connection')/
//     ws.on('close') in server.js.
//   - MAX_WS_CLIENTS, DEFAULT_SYMBOLS (config constants)
//   - the WebSocketServer + ws.on('connection') handler (moves in 7b)
//
// Per T-228 (and T-224's 6b convention): broker, alerts, paper are `let`
// bindings in server.js that get assigned inside init(). attachUpstreamFanout
// must read them via getters (closures over server.js scope) so the tick
// callback sees the LIVE values at call time, not the undefined values
// captured at mount time.
//
// notify is imported via require at the top of server.js -- function ref is
// stable, safe to pass by value.

'use strict';

function attachUpstreamFanout(deps) {
  const {
    wsClients,         // Set<WebSocket> -- shared ref, mutations visible
    DEFAULT_SYMBOLS,   // const array
    getBroker,         // () => broker
    getAlerts,         // () => alerts
    getPaper,          // () => paper
    notify,            // function reference from notify.js
  } = deps;

  let brokerUnsubscribe = null;
  let _lastUpstreamState = null;

  async function startBrokerFanout() {
    if (brokerUnsubscribe) return;
    const broker = getBroker();
    brokerUnsubscribe = await broker.subscribeTicks(DEFAULT_SYMBOLS, (tick) => {
      // 1. Evaluate alerts (synchronous, no I/O).
      try { const alerts = getAlerts(); if (alerts) alerts.evaluate(tick); } catch (e) { /* keep loop alive */ }
      // 2. Drive paper trading fills (synchronous, debounced persist).
      try { const paper = getPaper(); if (paper) paper.onTick(tick); } catch (e) { /* keep loop alive */ }
      // 3. Fan out to /ws clients.
      //
      // T-131 (Tier 75 Phase 2): per-WS tick filtering. Each client carries a
      // ws.symbolSet (Set<string>) built on connect from DEFAULT_SYMBOLS plus
      // their persisted watchlist, mutated by subscribe/unsubscribe messages.
      // If a client has no symbolSet (defensive, shouldn't happen) they fall
      // through to the legacy "everyone gets every tick" behavior so we never
      // drop traffic by accident.
      const sym = tick && tick.symbol;
      const payload = JSON.stringify({ type: 'tick', ...tick });
      for (const ws of wsClients) {
        if (ws.readyState !== 1) continue;
        if (ws.symbolSet && sym && !ws.symbolSet.has(sym)) continue;
        ws.send(payload);
      }
    });
  }

  // T99-T44: upstream-state broadcaster. Polls broker.health() every 10s and
  // broadcasts {type:'upstream_state', ...} to all /ws clients when any of the
  // connected/stalledOnToken/tickStale flags flip. Frontends use this to show
  // 'data feed frozen' banners without waiting for a missed tick to expose the
  // problem. Cheap: one in-process function call per 10s.
  function _broadcastUpstreamStateIfChanged() {
    try {
      const broker = getBroker();
      if (!broker) return; // not yet booted -- first ticks may fire before init
      const bh = (typeof broker.health === 'function') ? broker.health() : null;
      if (!bh) return;
      const cur = {
        connected: !!bh.connected,
        stalledOnToken: !!bh.stalledOnToken,
        tickStale: !!bh.tickStale,
      };
      if (!_lastUpstreamState
          || _lastUpstreamState.connected !== cur.connected
          || _lastUpstreamState.stalledOnToken !== cur.stalledOnToken
          || _lastUpstreamState.tickStale !== cur.tickStale) {
        const prev = _lastUpstreamState;
        _lastUpstreamState = cur;
        const payload = JSON.stringify({ type: 'upstream_state', ...cur });
        for (const ws of wsClients) {
          if (ws.readyState === 1) {
            try { ws.send(payload); } catch (e) { console.warn('[server] swallowed:', e && e.message); }
          }
        }
        console.log('[ws] upstream_state changed:', cur, '->', wsClients.size, 'clients');

        // T99-T64: Telegram notification on stall/recovery transitions. We
        // only alert on the binary stalledOnToken flip -- tickStale alone is
        // less urgent (often resolves in seconds) and would be noisy. Skip
        // the very first poll where `prev` is null (boot-time state isn't
        // a transition, just an initial read).
        try {
          if (prev !== null && prev.stalledOnToken !== cur.stalledOnToken) {
            if (cur.stalledOnToken) {
              notify('error', 'ATS broker stalled on token', {
                body: 'Kite WS rejected 3 consecutive reconnects (HTTP 403). Live data feed is OFFLINE. Reconnect from the Brokers screen or run sudo bash /opt/ats/scripts/morning-check.sh on the VM.',
                fields: { time: new Date().toISOString() },
                url: 'https://ats.rajasekarselvam.com/#brokers',
              }).catch(e => console.warn('[server] promise rejected:', e && e.message));
            } else {
              notify('success', 'ATS broker recovered', {
                body: 'Live data feed is back online. Ticker reconnecting + subscribing.',
                fields: { time: new Date().toISOString() },
              }).catch(e => console.warn('[server] promise rejected:', e && e.message));
            }
          }
        } catch (_) { /* notify must never throw from the broadcaster */ }
      }
    } catch (e) { /* never throw from the interval */ }
  }

  const _upstreamStateTimer = setInterval(_broadcastUpstreamStateIfChanged, 10_000);
  if (_upstreamStateTimer.unref) _upstreamStateTimer.unref();

  return { startBrokerFanout, _broadcastUpstreamStateIfChanged };
}

module.exports = { attachUpstreamFanout };
