'use strict';

// Watcher: scan the theatre's showtimes page for showings that match the
// movie + format + date window, and rank them by preference.
//
// NOTE: the DOM extraction below is heuristic (anchor elements whose text
// looks like a clock time, with movie title / format text in an ancestor
// container). It must be verified against the live page once network access
// to amctheatres.com is open — run `node src/main.js scan` and check output.

const { log, parseTimeText, toMinutes, dateRange } = require('./lib');
const { screenshot, dumpHtml } = require('./browser');

async function extractShowtimes(page) {
  return page.evaluate(() => {
    const results = [];
    const anchors = [...document.querySelectorAll('a[href]')];
    const timeRe = /^\s*\d{1,2}:\d{2}\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i;
    for (const a of anchors) {
      const text = (a.textContent || '').trim();
      if (!timeRe.test(text)) continue;
      // Walk up to find contextual title/format text.
      let container = a;
      let context = '';
      for (let i = 0; i < 8 && container.parentElement; i++) {
        container = container.parentElement;
        context = container.innerText || '';
        if (/(imax|dolby|laser|70\s*mm|digital)/i.test(context) && context.length > 40) break;
      }
      results.push({ time: text, href: a.href, context: context.slice(0, 600) });
    }
    return results;
  });
}

// Fandango theater-page URLs carry an opaque slug we can't know offline, so
// when config leaves showtimesUrl null we resolve it once per process via the
// vendor's search page: first link whose text matches the theatre name.
// VERIFY on live site once network access is open.
let resolvedTheatreUrl = null;

async function resolveTheatreUrl(cfg, page) {
  if (cfg.theatre.showtimesUrl) return cfg.theatre.showtimesUrl;
  if (resolvedTheatreUrl) return resolvedTheatreUrl;
  await page.goto(cfg.theatre.searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  const name = cfg.theatre.name;
  const href = await page.evaluate((theatreName) => {
    const links = [...document.querySelectorAll('a[href]')];
    const hit = links.find((a) => (a.textContent || '').trim().toLowerCase().includes(theatreName.toLowerCase()));
    return hit ? hit.href : null;
  }, name);
  if (!href) throw new Error(`could not resolve theatre page for "${name}" from ${cfg.theatre.searchUrl}`);
  resolvedTheatreUrl = href;
  log('resolved theatre page:', href);
  return href;
}

function showtimeUrlForDate(base, dateISO) {
  // VERIFY on live site: Fandango theater pages accept ?date=YYYY-MM-DD.
  return `${base}${base.includes('?') ? '&' : '?'}date=${dateISO}`;
}

async function scanDate(cfg, page, dateISO) {
  const base = await resolveTheatreUrl(cfg, page);
  const url = showtimeUrlForDate(base, dateISO);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000); // let client-side rendering settle
  const raw = await extractShowtimes(page);
  const titleRe = new RegExp(cfg.movie.titlePattern, 'i');
  const formatRe = new RegExp(cfg.movie.formatPattern, 'i');
  const matches = raw.filter((r) => titleRe.test(r.context) && formatRe.test(r.context));
  return matches.map((m) => ({
    date: dateISO,
    time: m.time,
    minutes: parseTimeText(m.time),
    url: m.href,
  })).filter((m) => m.minutes !== null);
}

function rankShowtimes(cfg, showtimes) {
  const evStart = toMinutes(cfg.showtimePreference.eveningStart);
  const evEnd = toMinutes(cfg.showtimePreference.eveningEnd);
  const scored = showtimes.map((s) => {
    let score = 0;
    if (s.minutes >= evStart && s.minutes <= evEnd) score += cfg.showtimePreference.eveningBonus;
    // Mild preference for earlier dates and for prime-time proximity (19:30).
    score -= [...dateRange(cfg.dates.start, cfg.dates.end)].indexOf(s.date) * 2;
    score -= Math.abs(s.minutes - toMinutes('19:30')) / 30;
    return { ...s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function scanAll(cfg, page, { debugArtifacts = false } = {}) {
  const found = [];
  for (const dateISO of dateRange(cfg.dates.start, cfg.dates.end)) {
    try {
      const matches = await scanDate(cfg, page, dateISO);
      found.push(...matches);
      if (matches.length) log(`  ${dateISO}: ${matches.length} matching showtime(s):`, matches.map((m) => m.time).join(', '));
    } catch (e) {
      log(`  ${dateISO}: scan error:`, e.message.split('\n')[0]);
      if (debugArtifacts) {
        await screenshot(cfg, page, `scan-error-${dateISO}`);
        await dumpHtml(cfg, page, `scan-error-${dateISO}`);
      }
    }
  }
  return rankShowtimes(cfg, found);
}

module.exports = { scanAll, scanDate, rankShowtimes, extractShowtimes, resolveTheatreUrl };
