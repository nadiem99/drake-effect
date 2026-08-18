'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { resolvePath, ensureDir, log } = require('./lib');

// This environment routes all egress through a TLS-terminating proxy; the
// proxy CA must be in the NSS store (see README) and the proxy passed
// explicitly, because Chromium does not read HTTPS_PROXY on its own.
function launchOptions() {
  const opts = { headless: true };
  const pinned = '/opt/pw-browsers/chromium';
  if (fs.existsSync(pinned)) opts.executablePath = pinned;
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY };
  return opts;
}

async function launch(cfg, { useAuth = true } = {}) {
  const browser = await chromium.launch(launchOptions());
  const ctxOpts = {
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  };
  const storagePath = resolvePath(cfg.paths.storageState);
  if (useAuth && fs.existsSync(storagePath)) {
    ctxOpts.storageState = storagePath;
    log('loaded saved AMC session from', storagePath);
  } else if (useAuth) {
    log('WARNING: no saved AMC session at', storagePath, '- run `node src/main.js login` first');
  }
  const context = await browser.newContext(ctxOpts);
  context.setDefaultTimeout(30000);
  return { browser, context };
}

let shotCounter = 0;
async function screenshot(cfg, page, label) {
  const dir = ensureDir(resolvePath(cfg.paths.screenshots));
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${String(++shotCounter).padStart(3, '0')}_${label}.png`;
  const file = path.join(dir, name);
  try {
    await page.screenshot({ path: file, fullPage: false });
    log('screenshot:', name);
  } catch (e) {
    log('screenshot failed:', e.message);
  }
  return file;
}

async function dumpHtml(cfg, page, label) {
  const dir = ensureDir(resolvePath(cfg.paths.screenshots));
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${label}.html`);
  try {
    fs.writeFileSync(file, await page.content());
  } catch (e) {
    log('html dump failed:', e.message);
  }
  return file;
}

module.exports = { launch, screenshot, dumpHtml };
