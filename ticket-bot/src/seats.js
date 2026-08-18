'use strict';

// Pure seat-selection logic — no browser dependencies, fully unit-testable.
//
// Seat model: { id, row: 'G', col: 10, available: bool, kind: 'standard'|'wheelchair'|'companion' }
// Rows are assumed alphabetical front-to-back (AMC convention: row A closest
// to the screen). Adjacency is consecutive col numbers within the same row.
//
// Policy (from the owner): maximize ticket count among decent seats —
// 3 (contiguous preferred, split OK) > 2 > 1. "Decent" = standard seat, not in
// the front `frontRowsToAvoid` rows. If no decent seat exists at all and
// lastResortAnySeat is set, repeat the search over every available seat.

function rowOrder(seats) {
  const rows = [...new Set(seats.map((s) => s.row))];
  rows.sort((a, b) => (a.length - b.length) || a.localeCompare(b));
  return rows;
}

// Higher is better. Peak at ~60% of the way back, centered columns.
function seatScore(seat, rows, colsByRow) {
  const rowIdx = rows.indexOf(seat.row);
  const idealRow = (rows.length - 1) * 0.6;
  const rowSpread = Math.max(rows.length / 2, 1);
  const rowScore = 100 - 40 * Math.abs(rowIdx - idealRow) / rowSpread;

  const cols = colsByRow.get(seat.row);
  const center = (cols.min + cols.max) / 2;
  const halfWidth = Math.max((cols.max - cols.min) / 2, 1);
  const colScore = 100 - 60 * Math.abs(seat.col - center) / halfWidth;

  return rowScore + colScore;
}

function buildContext(seats) {
  const rows = rowOrder(seats);
  const colsByRow = new Map();
  for (const s of seats) {
    const c = colsByRow.get(s.row) || { min: Infinity, max: -Infinity };
    c.min = Math.min(c.min, s.col);
    c.max = Math.max(c.max, s.col);
    colsByRow.set(s.row, c);
  }
  return { rows, colsByRow };
}

function contiguousBlocks(pool, n) {
  const byRow = new Map();
  for (const s of pool) {
    if (!byRow.has(s.row)) byRow.set(s.row, []);
    byRow.get(s.row).push(s);
  }
  const blocks = [];
  for (const rowSeats of byRow.values()) {
    rowSeats.sort((a, b) => a.col - b.col);
    for (let i = 0; i + n <= rowSeats.length; i++) {
      const run = rowSeats.slice(i, i + n);
      let ok = true;
      for (let j = 1; j < n; j++) {
        if (run[j].col !== run[j - 1].col + 1) { ok = false; break; }
      }
      if (ok) blocks.push(run);
    }
  }
  return blocks;
}

function totalScore(block, ctx) {
  return block.reduce((sum, s) => sum + seatScore(s, ctx.rows, ctx.colsByRow), 0);
}

function best(arr, keyFn) {
  let bestItem = null;
  let bestKey = -Infinity;
  for (const item of arr) {
    const k = keyFn(item);
    if (k > bestKey) { bestKey = k; bestItem = item; }
  }
  return bestItem;
}

// Pick up to `want` seats from `pool`. Prefers contiguous; allows a 2+1 split
// (with penalty) and scattered singles before dropping the count.
function pickCount(pool, want, ctx, splitPenalty) {
  if (pool.length === 0) return null;
  const contig = contiguousBlocks(pool, want);
  const bestContig = best(contig, (b) => totalScore(b, ctx));

  let bestSplit = null;
  if (want === 3) {
    const pairs = contiguousBlocks(pool, 2);
    const bestPair = best(pairs, (b) => totalScore(b, ctx));
    if (bestPair) {
      const rest = pool.filter((s) => !bestPair.includes(s));
      const single = best(rest, (s) => seatScore(s, ctx.rows, ctx.colsByRow));
      if (single) bestSplit = { seats: [...bestPair, single], penalty: splitPenalty };
    }
  }
  if (!bestContig && !bestSplit && pool.length >= want) {
    // Scattered singles as a last shape for this count.
    const sorted = [...pool].sort((a, b) => seatScore(b, ctx.rows, ctx.colsByRow) - seatScore(a, ctx.rows, ctx.colsByRow));
    bestSplit = { seats: sorted.slice(0, want), penalty: splitPenalty * (want - 1) };
  }

  const contigResult = bestContig ? { seats: bestContig, score: totalScore(bestContig, ctx), contiguous: true } : null;
  const splitResult = bestSplit ? { seats: bestSplit.seats, score: totalScore(bestSplit.seats, ctx) - bestSplit.penalty, contiguous: false } : null;
  if (contigResult && splitResult) return contigResult.score >= splitResult.score ? contigResult : splitResult;
  return contigResult || splitResult;
}

/**
 * @param {Array} seats  full seat map
 * @param {Object} opts  { maxTickets, minTickets, frontRowsToAvoid, splitPenalty, lastResortAnySeat }
 * @returns {null | { seats, count, contiguous, lastResort }}
 */
function chooseSeats(seats, opts) {
  const available = seats.filter((s) => s.available && s.kind === 'standard');
  if (available.length === 0) return null;
  const ctx = buildContext(seats);
  const frontRows = new Set(ctx.rows.slice(0, opts.frontRowsToAvoid));
  const decent = available.filter((s) => !frontRows.has(s.row));

  for (const pool of [decent, opts.lastResortAnySeat ? available : []]) {
    if (pool.length === 0) continue;
    for (let want = opts.maxTickets; want >= opts.minTickets; want--) {
      const pick = pickCount(pool, want, ctx, opts.splitPenalty);
      if (pick) {
        return { seats: pick.seats, count: pick.seats.length, contiguous: pick.contiguous, lastResort: pool !== decent };
      }
    }
  }
  return null;
}

function describe(selection) {
  if (!selection) return 'no seats selectable';
  const list = selection.seats.map((s) => `${s.row}${s.col}`).join(', ');
  return `${selection.count} seat(s): ${list}` +
    (selection.contiguous ? ' (together)' : ' (split)') +
    (selection.lastResort ? ' [last-resort rows]' : '');
}

module.exports = { chooseSeats, describe, seatScore, buildContext };
