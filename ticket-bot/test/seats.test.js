'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { chooseSeats, describe } = require('../src/seats');

const OPTS = { maxTickets: 3, minTickets: 1, frontRowsToAvoid: 3, splitPenalty: 15, lastResortAnySeat: true };

// Build a rectangular auditorium. rows: ['A'..], colCount, then mark
// availability with a predicate.
function auditorium(rowLetters, colCount, availableFn, kindFn = () => 'standard') {
  const seats = [];
  for (const row of rowLetters) {
    for (let col = 1; col <= colCount; col++) {
      seats.push({ id: `${row}${col}`, row, col, available: availableFn(row, col), kind: kindFn(row, col) });
    }
  }
  return seats;
}

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];

test('picks 3 contiguous center seats when the map is wide open', () => {
  const seats = auditorium(ROWS, 20, () => true);
  const sel = chooseSeats(seats, OPTS);
  assert.strictEqual(sel.count, 3);
  assert.ok(sel.contiguous, 'expected contiguous: ' + describe(sel));
  assert.ok(!sel.lastResort);
  // Center-ish: all cols within 8..13, row in the back half but not last row area
  for (const s of sel.seats) {
    assert.ok(s.col >= 8 && s.col <= 13, 'seat not centered: ' + s.id);
    assert.ok(!['A', 'B', 'C'].includes(s.row), 'front row picked: ' + s.id);
  }
});

test('never picks the front rows while decent seats exist', () => {
  // Only front rows + one good back pair available
  const seats = auditorium(ROWS, 20, (row, col) => ['A', 'B', 'C'].includes(row) || (row === 'G' && (col === 10 || col === 11)));
  const sel = chooseSeats(seats, OPTS);
  assert.strictEqual(sel.count, 2);
  assert.deepStrictEqual(sel.seats.map((s) => s.row), ['G', 'G']);
});

test('falls back to 2 then 1 as availability shrinks', () => {
  const two = auditorium(ROWS, 20, (row, col) => row === 'F' && (col === 4 || col === 5));
  assert.strictEqual(chooseSeats(two, OPTS).count, 2);
  const one = auditorium(ROWS, 20, (row, col) => row === 'F' && col === 4);
  assert.strictEqual(chooseSeats(one, OPTS).count, 1);
});

test('takes a 2+1 split over dropping to 2 when 3 contiguous do not exist', () => {
  const seats = auditorium(ROWS, 20, (row, col) =>
    (row === 'F' && (col === 10 || col === 11)) || (row === 'G' && col === 10));
  const sel = chooseSeats(seats, OPTS);
  assert.strictEqual(sel.count, 3);
  assert.ok(!sel.contiguous);
});

test('front row only as a true last resort', () => {
  const seats = auditorium(ROWS, 20, (row, col) => row === 'A' && col >= 9 && col <= 11);
  const sel = chooseSeats(seats, OPTS);
  assert.strictEqual(sel.count, 3);
  assert.ok(sel.lastResort);
  const noLastResort = chooseSeats(seats, { ...OPTS, lastResortAnySeat: false });
  assert.strictEqual(noLastResort, null);
});

test('ignores wheelchair/companion seats and sold-out maps', () => {
  const wc = auditorium(ROWS, 20, () => true, () => 'wheelchair');
  assert.strictEqual(chooseSeats(wc, OPTS), null);
  const sold = auditorium(ROWS, 20, () => false);
  assert.strictEqual(chooseSeats(sold, OPTS), null);
});

test('never returns more than maxTickets', () => {
  const seats = auditorium(ROWS, 20, () => true);
  const sel = chooseSeats(seats, OPTS);
  assert.ok(sel.count <= 3);
});
