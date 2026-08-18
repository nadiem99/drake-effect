'use strict';

// Checkout driver. Modeled as a state machine over "what page are we on",
// because AMC's flow order (seats -> ticket types -> payment) can vary and we
// must react to whatever actually renders. Every transition is screenshotted.
//
// Hard rules:
//  - Never buy more than cfg.tickets.max seats.
//  - Never proceed past a human-verification / bot-check page: screenshot,
//    mark state "blocked", stop. No evasion attempts.
//  - DRY_RUN=1 stops one click before the final purchase.
//  - state.json guards against double purchase (see state.js).
//
// Selectors marked VERIFY are best-effort guesses that must be checked on the
// live site during the rehearsal run before the real drop.

const { log, sleep } = require('./lib');
const { screenshot, dumpHtml } = require('./browser');
const { chooseSeats, describe } = require('./seats');
const state = require('./state');

const DRY_RUN = process.env.DRY_RUN === '1';

async function bodyText(page) {
  try {
    return (await page.evaluate(() => document.body.innerText)) || '';
  } catch {
    return '';
  }
}

async function classifyPage(page) {
  const text = await bodyText(page);
  const t = text.toLowerCase();
  if (/(are you a human|verify you are|unusual activity|captcha|robot|access denied|waiting room|you are in line)/i.test(t)) return 'bot_check';
  if (/(order number|confirmation number|you're all set|purchase complete|order confirmed)/i.test(t)) return 'confirmation';
  if (/(payment|card number|billing|gift card|place order|complete purchase)/i.test(t) && /total/i.test(t)) return 'payment';
  const seatCount = await page.locator('[aria-label*="Row" i], [aria-label*="Seat" i]').count();
  if (seatCount > 20) return 'seat_map';
  if (/(adult|child|senior)/i.test(t) && /(ticket)/i.test(t)) return 'ticket_types';
  if (/(sign in|log in)/i.test(t) && await page.locator('input[type="password"]').count() > 0) return 'sign_in';
  return 'unknown';
}

// --- seat map ---------------------------------------------------------------

const SEAT_LABEL_RE = /(?:row\s*)?([A-Z]{1,2})[\s,-]*(?:seat\s*)?(\d{1,2})/i;

async function extractSeats(page) {
  // VERIFY: AMC seat buttons carry aria-labels like "F12 Available" or
  // "Row F Seat 12, Wheelchair accessible". Availability signals vary.
  const handles = await page.locator('[aria-label*="Row" i], [aria-label*="Seat" i], button[aria-label]').all();
  const seats = [];
  const seen = new Set();
  for (const h of handles) {
    const label = (await h.getAttribute('aria-label')) || '';
    const m = label.match(SEAT_LABEL_RE);
    if (!m) continue;
    const id = `${m[1].toUpperCase()}${Number(m[2])}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const disabled = (await h.getAttribute('aria-disabled')) === 'true' || (await h.isDisabled().catch(() => false));
    const unavailable = /unavailable|occupied|taken|reserved|sold/i.test(label);
    const kind = /wheelchair|companion/i.test(label) ? 'wheelchair' : 'standard';
    seats.push({ id, row: m[1].toUpperCase(), col: Number(m[2]), available: !disabled && !unavailable, kind, label });
  }
  return seats;
}

async function clickSeat(page, seat) {
  const target = page.locator(`[aria-label*="${seat.row}" i]`).filter({ hasText: /^$|./ });
  // Click by the exact label we extracted — most precise handle we have.
  const byLabel = page.locator(`[aria-label="${seat.label}"]`).first();
  if (await byLabel.count()) {
    await byLabel.click();
    return;
  }
  await target.first().click(); // fallback; rehearsal must confirm this is never needed
}

async function handleSeatMap(cfg, page) {
  const seats = await extractSeats(page);
  const available = seats.filter((s) => s.available).length;
  log(`seat map: ${seats.length} seats parsed, ${available} available`);
  if (seats.length === 0) throw new Error('seat map parsed 0 seats — selectors need verification');
  const selection = chooseSeats(seats, {
    maxTickets: cfg.tickets.max,
    minTickets: cfg.tickets.min,
    frontRowsToAvoid: cfg.seats.frontRowsToAvoid,
    splitPenalty: cfg.seats.splitPenalty,
    lastResortAnySeat: cfg.seats.lastResortAnySeat,
  });
  if (!selection) throw new Error('no acceptable seats available');
  log('selecting', describe(selection));
  for (const seat of selection.seats) {
    await clickSeat(page, seat);
    await sleep(400 + Math.random() * 400);
  }
  await screenshot(cfg, page, 'seats-selected');
  await clickContinue(page);
  return selection;
}

// --- other pages ------------------------------------------------------------

async function clickContinue(page) {
  // VERIFY: continue/next button naming on live flow.
  const btn = page.locator('button, a').filter({ hasText: /^(continue|next|proceed|confirm seats|checkout)/i }).first();
  await btn.click();
}

async function handleTicketTypes(cfg, page, ticketCount) {
  // VERIFY: quantity steppers. Try "+" button next to the Adult row.
  const adultRow = page.locator('*', { hasText: new RegExp(`^\\s*${cfg.tickets.type}`, 'i') }).last();
  const plus = page.locator('button[aria-label*="add" i], button[aria-label*="increase" i], button:has-text("+")');
  for (let i = 0; i < ticketCount; i++) {
    await plus.first().click();
    await sleep(300);
  }
  void adultRow;
  await screenshot(cfg, page, 'ticket-types');
  await clickContinue(page);
}

async function handleSignIn(cfg, page) {
  // Saved storageState should make this page never appear. If it does and
  // credentials are in the environment, sign in once, without retry storms.
  const email = process.env.TICKET_EMAIL;
  const password = process.env.TICKET_PASSWORD;
  if (!email || !password) throw new Error('sign-in page appeared but TICKET_EMAIL/TICKET_PASSWORD not set');
  await page.locator('input[type="email"], input[name*="email" i]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await screenshot(cfg, page, 'sign-in-filled');
  await page.locator('button[type="submit"], button:has-text("Sign In")').first().click();
  await page.waitForLoadState('domcontentloaded');
}

async function readTotalUsd(page) {
  const text = await bodyText(page);
  const m = text.match(/total[^$]*\$\s*([\d,]+\.\d{2})/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// Set the moment the final purchase button is clicked; from then on a failure
// must NOT return the state to retryable — the order may exist server-side.
let purchaseClicked = false;

async function handlePayment(cfg, page) {
  const total = await readTotalUsd(page);
  log('payment page, order total:', total === null ? 'UNPARSED' : `$${total}`);
  if (total !== null && total > cfg.tickets.maxTotalUsd) {
    throw new Error(`total $${total} exceeds cap $${cfg.tickets.maxTotalUsd} — refusing`);
  }
  // VERIFY: saved payment method should be pre-selected for a signed-in
  // account. If a CVV re-entry field is present, fill from env.
  const cvvField = page.locator('input[name*="cvv" i], input[aria-label*="security code" i], input[name*="securityCode" i]').first();
  if (await cvvField.count()) {
    if (!process.env.TICKET_CVV) throw new Error('payment page asks for CVV but TICKET_CVV not set');
    await cvvField.fill(process.env.TICKET_CVV);
  }
  await screenshot(cfg, page, 'payment-ready');

  if (DRY_RUN) {
    log('DRY_RUN: stopping one click before purchase.');
    return { dryRun: true, total };
  }
  const purchase = page.locator('button').filter({ hasText: /place order|complete purchase|purchase|pay now/i }).first();
  purchaseClicked = true;
  await purchase.click();
  return { dryRun: false, total };
}

async function handleConfirmation(cfg, page) {
  const text = await bodyText(page);
  const m = text.match(/(?:order|confirmation)\s*(?:number|#)[:\s]*([A-Z0-9-]{6,})/i);
  await screenshot(cfg, page, 'confirmation');
  await dumpHtml(cfg, page, 'confirmation');
  return { orderNumber: m ? m[1] : null };
}

// --- driver -----------------------------------------------------------------

async function attemptPurchase(cfg, context, showtime) {
  if (!state.canStartPurchase(cfg)) {
    log('refusing to start: state is', state.read(cfg).status);
    return { ok: false, reason: 'state_guard' };
  }
  state.transition(cfg, 'in_flight', { note: `attempting ${showtime.date} ${showtime.time}`, showtime });

  const page = await context.newPage();
  let selection = null;
  try {
    await page.goto(showtime.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(2500);
      const kind = await classifyPage(page);
      log(`step ${step}: page looks like "${kind}"`);
      await screenshot(cfg, page, `step${step}-${kind}`);

      if (kind === 'bot_check') {
        await dumpHtml(cfg, page, 'bot-check');
        state.transition(cfg, 'blocked', { note: 'human verification page — stopping, no bypass' });
        return { ok: false, reason: 'bot_check' };
      }
      if (kind === 'seat_map') {
        selection = await handleSeatMap(cfg, page);
      } else if (kind === 'ticket_types') {
        await handleTicketTypes(cfg, page, selection ? selection.count : cfg.tickets.max);
      } else if (kind === 'sign_in') {
        await handleSignIn(cfg, page);
      } else if (kind === 'payment') {
        const pay = await handlePayment(cfg, page);
        if (pay.dryRun) {
          state.transition(cfg, 'idle', { note: 'dry run completed through payment page' });
          return { ok: true, dryRun: true, selection, total: pay.total };
        }
      } else if (kind === 'confirmation') {
        const conf = await handleConfirmation(cfg, page);
        state.transition(cfg, 'purchased', { note: `order ${conf.orderNumber}`, order: conf, selection: selection && describe(selection), showtime });
        return { ok: true, order: conf, selection };
      } else {
        await dumpHtml(cfg, page, `unknown-step${step}`);
        // Unknown page: try a generic continue once, else keep waiting.
        await clickContinue(page).catch(() => {});
      }
    }
    throw new Error('flow did not reach confirmation within step limit');
  } catch (e) {
    log('purchase attempt failed:', e.message.split('\n')[0]);
    await screenshot(cfg, page, 'failure');
    await dumpHtml(cfg, page, 'failure');
    // Only mark failed (retryable) if the purchase button was never clicked.
    // After that click the order may exist server-side even if we crashed, so
    // stay "in_flight" — which blocks all retries until a human checks.
    const s = state.read(cfg);
    if (s.status === 'in_flight' && !purchaseClicked) {
      state.transition(cfg, 'failed', { note: e.message.split('\n')[0] });
    } else if (purchaseClicked) {
      state.transition(cfg, 'blocked', { note: 'error AFTER purchase click — check AMC account/email before any retry: ' + e.message.split('\n')[0] });
    }
    return { ok: false, reason: e.message };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { attemptPurchase, classifyPage, extractSeats };
