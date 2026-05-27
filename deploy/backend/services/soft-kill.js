// T-484: soft-kill flag service.
//
// In-memory boolean checked by pre-trade.js as GATE 0 (fires BEFORE the
// env KILL_SWITCH check). The UI "Kill" button (src/shell.jsx, top-right
// of every page) now calls POST /api/admin/soft-kill which sets this flag.
// Before T-484, that button dispatched a frontend-only event that did
// nothing -- a theatre control that gave operators false confidence they
// had halted trading.
//
// Design:
//   - In-memory only. Auto-resets on container restart -- the env var
//     KILL_SWITCH is the persistent fallback for a permanent halt.
//   - Single module instance via Node's require-cache, so the routes
//     module and the pre-trade module reference the SAME flag.
//   - Captures who fired it, when, and a free-text reason for audit.
//   - No setters at boot -- starts cleared. Operator must explicitly fire.
//
// Public API:
//   const sk = require('./services/soft-kill');
//   sk.set({ userId, reason })  -- fire the kill
//   sk.reset()                  -- clear (operator action, audit-logged separately)
//   sk.get()                    -- boolean, true if active
//   sk.state()                  -- { active, firedAt, firedBy, reason }

'use strict';

let _active = false;
let _firedAt = null;
let _firedBy = null;
let _reason = null;
// T-490: snapshot of the firing user's activeModes BEFORE the kill, so reset
// can restore them. {modeId: {enabled, capitalPct, ...}} or null if not set.
let _snapshotActiveModes = null;

function set(opts) {
  const o = opts || {};
  _active = true;
  _firedAt = Date.now();
  _firedBy = (o.userId != null) ? String(o.userId) : null;
  _reason = o.reason ? String(o.reason).slice(0, 200) : null;
  // T-490: capture the user's mode state at fire-time so reset can restore.
  // Caller (admin-kill route) passes the snapshot it just read from
  // riskConfigService.get(userId).activeModes.
  if (o.snapshotActiveModes != null && typeof o.snapshotActiveModes === 'object') {
    _snapshotActiveModes = JSON.parse(JSON.stringify(o.snapshotActiveModes));
  } else {
    _snapshotActiveModes = null;
  }
}

function reset() {
  _active = false;
  _firedAt = null;
  _firedBy = null;
  _reason = null;
  _snapshotActiveModes = null;
}

function get() { return _active; }

function getSnapshotActiveModes() { return _snapshotActiveModes; }

function state() {
  return {
    active: _active,
    firedAt: _firedAt,
    firedBy: _firedBy,
    reason: _reason,
    hasSnapshot: _snapshotActiveModes != null,
  };
}

module.exports = { set, reset, get, getSnapshotActiveModes, state };
