'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Poll interval with jitter so requests don't land on a fixed beat.
function jitteredDelayMs(cfg) {
  const base = cfg.watch.pollSeconds * 1000;
  const jitter = cfg.watch.jitterSeconds * 1000;
  return base + Math.floor(Math.random() * jitter);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function resolvePath(rel) {
  return path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
}

// "16:30" -> minutes since midnight
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Parse "7:00 PM" / "7:00pm" / "19:00" -> minutes since midnight, or null.
function parseTimeText(text) {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3] ? m[3][0].toLowerCase() : null;
  if (ap === 'p' && h !== 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function* dateRange(startISO, endISO) {
  const d = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

module.exports = { ROOT, loadConfig, log, sleep, jitteredDelayMs, ensureDir, resolvePath, toMinutes, parseTimeText, dateRange };
