'use strict';

// Idempotency guard. The bot must never buy twice: once a purchase attempt
// starts the state moves to "in_flight", and only an explicit outcome
// (purchased / failed) moves it on. A crash leaves "in_flight" on disk, which
// blocks further attempts until a human inspects the screenshots and resets.

const fs = require('fs');
const path = require('path');
const { resolvePath, ensureDir, log } = require('./lib');

const STATUSES = ['idle', 'in_flight', 'purchased', 'blocked', 'failed'];

function statePath(cfg) {
  return resolvePath(cfg.paths.state);
}

function read(cfg) {
  const p = statePath(cfg);
  if (!fs.existsSync(p)) return { status: 'idle', history: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(cfg, state) {
  const p = statePath(cfg);
  ensureDir(path.dirname(p));
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

function transition(cfg, status, detail = {}) {
  if (!STATUSES.includes(status)) throw new Error('bad status: ' + status);
  const state = read(cfg);
  state.history = state.history || [];
  state.history.push({ at: new Date().toISOString(), from: state.status, to: status, ...detail });
  state.status = status;
  Object.assign(state, detail);
  write(cfg, state);
  log(`state: ${status}`, detail.note || '');
  return state;
}

// Returns true if it is safe to start a purchase attempt.
function canStartPurchase(cfg) {
  const s = read(cfg);
  return s.status === 'idle' || s.status === 'failed';
}

module.exports = { read, transition, canStartPurchase };
