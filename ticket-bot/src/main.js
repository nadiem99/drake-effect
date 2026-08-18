'use strict';

// Entry point.
//
//   node src/main.js login        capture AMC session (needs AMC_EMAIL/AMC_PASSWORD)
//   node src/main.js scan         one-off: list matching showtimes right now
//   node src/main.js watch        poll until tickets drop, then buy (DRY_RUN=1 to rehearse)
//   node src/main.js buy <url>    drive checkout for a specific showtime URL
//   node src/main.js status       print state.json
//
// The hard cap of 3 tickets and the no-double-purchase guard live in
// config.json (tickets.max) and src/state.js respectively.

const fs = require('fs');
const { loadConfig, loadSecrets, log, sleep, jitteredDelayMs, resolvePath } = require('./lib');
const { launch } = require('./browser');
const { scanAll } = require('./showtimes');
const { attemptPurchase } = require('./buyer');
const { captureLogin } = require('./login');
const state = require('./state');

async function runScan(cfg) {
  const { browser, context } = await launch(cfg);
  try {
    const page = await context.newPage();
    const ranked = await scanAll(cfg, page, { debugArtifacts: true });
    if (!ranked.length) {
      log('no matching showtimes found (movie/format/date filters)');
    } else {
      log('ranked candidates:');
      for (const s of ranked) log(`  ${s.date} ${s.time} score=${s.score.toFixed(1)} ${s.url}`);
    }
    return ranked;
  } finally {
    await browser.close();
  }
}

async function runWatch(cfg) {
  log(`watching for: ${cfg.movie.titlePattern} / ${cfg.movie.formatPattern} at ${cfg.theatre.name}, ${cfg.dates.start}..${cfg.dates.end}`);
  log(`tickets: up to ${cfg.tickets.max} (min ${cfg.tickets.min}), DRY_RUN=${process.env.DRY_RUN === '1'}`);
  if (state.read(cfg).status === 'purchased') {
    log('state is already "purchased" — nothing to do');
    return;
  }
  const { browser, context } = await launch(cfg);
  try {
    const page = await context.newPage();
    for (let cycle = 1; ; cycle++) {
      const s = state.read(cfg);
      if (s.status === 'purchased') { log('purchase recorded — watcher exiting'); return; }
      if (s.status === 'blocked' || s.status === 'in_flight') {
        log(`state is "${s.status}" — human attention needed, watcher exiting`);
        return;
      }
      let ranked = [];
      try {
        ranked = await scanAll(cfg, page);
      } catch (e) {
        log('scan cycle failed:', e.message.split('\n')[0]);
      }
      if (ranked.length) {
        log(`TICKETS FOUND (cycle ${cycle}) — ${ranked.length} candidate showtime(s)`);
        for (const candidate of ranked.slice(0, cfg.watch.maxBuyAttempts)) {
          const result = await attemptPurchase(cfg, context, candidate);
          if (result.ok) {
            const resultPath = resolvePath(cfg.paths.result);
            fs.writeFileSync(resultPath, JSON.stringify({ at: new Date().toISOString(), candidate, result }, null, 2));
            log(result.dryRun ? 'DRY RUN SUCCESS — flow verified through payment page' : 'PURCHASE COMPLETE');
            return;
          }
          if (result.reason === 'bot_check' || result.reason === 'state_guard') return;
          log('candidate failed, trying next preferred showtime...');
        }
        log('all candidates failed this cycle; continuing to watch');
      } else if (cycle % 10 === 0) {
        log(`cycle ${cycle}: nothing yet`);
      }
      await sleep(jitteredDelayMs(cfg));
    }
  } finally {
    await browser.close();
  }
}

async function runBuy(cfg, url) {
  if (!url) throw new Error('usage: node src/main.js buy <showtime-url>');
  const { browser, context } = await launch(cfg);
  try {
    const result = await attemptPurchase(cfg, context, { date: 'manual', time: 'manual', url });
    log('result:', JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

async function main() {
  loadSecrets();
  const cfg = loadConfig();
  const [, , cmd, arg] = process.argv;
  switch (cmd) {
    case 'login': return captureLogin(cfg);
    case 'scan': return runScan(cfg);
    case 'watch': return runWatch(cfg);
    case 'buy': return runBuy(cfg, arg);
    case 'status': return console.log(JSON.stringify(state.read(cfg), null, 2));
    default:
      console.log('usage: node src/main.js <login|scan|watch|buy <url>|status>');
      process.exit(2);
  }
}

main().catch((e) => {
  log('FATAL:', e.message);
  process.exit(1);
});
