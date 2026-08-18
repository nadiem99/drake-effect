'use strict';

// One-time login capture: signs into the ticket vendor (cfg.vendor.signInUrl,
// currently Fandango) with TICKET_EMAIL / TICKET_PASSWORD from the
// environment (or secrets/env) and saves the authenticated browser session
// (cookies + storage) to the storageState path, so the purchase run never has
// to touch the password again.
//
// VERIFY on live site: sign-in URL and field selectors.

const fs = require('fs');
const path = require('path');
const { log } = require('./lib');
const { launch, screenshot, dumpHtml } = require('./browser');
const { resolvePath, ensureDir } = require('./lib');

async function captureLogin(cfg) {
  const email = process.env.TICKET_EMAIL;
  const password = process.env.TICKET_PASSWORD;
  if (!email || !password) throw new Error('set TICKET_EMAIL and TICKET_PASSWORD (secrets/env)');

  const { browser, context } = await launch(cfg, { useAuth: false });
  const page = await context.newPage();
  try {
    await page.goto(cfg.vendor.signInUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    await screenshot(cfg, page, 'login-page');

    await page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], button:has-text("Sign In")').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);
    await screenshot(cfg, page, 'login-after-submit');

    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    if (/(incorrect|invalid|try again|doesn.t match)/i.test(text)) {
      await dumpHtml(cfg, page, 'login-rejected');
      throw new Error(`${cfg.vendor.name} rejected the credentials — see screenshots`);
    }
    if (/(verify|captcha|robot|code sent|one-time)/i.test(text)) {
      await dumpHtml(cfg, page, 'login-challenge');
      throw new Error(`${cfg.vendor.name} presented a verification challenge during login — see screenshots`);
    }

    const storagePath = resolvePath(cfg.paths.storageState);
    ensureDir(path.dirname(storagePath));
    await context.storageState({ path: storagePath });
    fs.chmodSync(storagePath, 0o600);
    log('saved authenticated session to', storagePath);
  } finally {
    await browser.close();
  }
}

module.exports = { captureLogin };
