// P1-CHG: derived daily-change previous-close selection (frontend B logic).
// Mirrors public/js/adapters.js derivePreviousClose without a DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';

function derivePreviousClose({ price, previousClose, asOf, researchGroup }, bars) {
  if (!Number.isFinite(price)) return null;
  if (Number.isFinite(previousClose) && previousClose > 0) return previousClose;
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const sorted = bars.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
  if (researchGroup === 'fx') {
    const asOfDay = (asOf || '').slice(0, 10);
    if (!asOfDay) return null;
    const prior = sorted.filter((b) => b.time < asOfDay && Number.isFinite(b.close));
    return prior.length ? prior[prior.length - 1].close : null;
  }
  if (researchGroup === 'crypto') {
    const today = new Date().toISOString().slice(0, 10);
    const confirmed = sorted.filter((b) => b.time < today && Number.isFinite(b.close));
    return confirmed.length ? confirmed[confirmed.length - 1].close : null;
  }
  return null; // metals and others stay '—'
}

function changePercent(item, bars) {
  if (!Number.isFinite(item.price)) return null;
  const prev = derivePreviousClose(item, bars);
  return Number.isFinite(prev) && prev > 0 ? (item.price / prev - 1) * 100 : null;
}

const fxBars = [
  { time: '2026-09-02', close: 159.6 },
  { time: '2026-09-03', close: 156.01 },
  { time: '2026-09-04', close: 156.25 }, // Friday
];

test('FX Friday quote uses Thursday close (not Friday itself)', () => {
  const item = { price: 156.25, asOf: '2026-09-04T16:00:00Z', researchGroup: 'fx' };
  const prev = derivePreviousClose(item, fxBars);
  assert.equal(prev, 156.01); // 2026-09-03, not 156.25
  assert.ok(Number.isFinite(changePercent(item, fxBars)));
});

test('FX holiday skip: Monday quote uses last prior business day', () => {
  // Imagine a Monday 2026-09-07 following a Friday 09-04; holiday 09-07 means
  // the quote.asOf is still 09-04 (no new ECB rate). Prior day is 09-03.
  const item = { price: 156.25, asOf: '2026-09-04T16:00:00Z', researchGroup: 'fx' };
  const prev = derivePreviousClose(item, fxBars);
  assert.equal(prev, 156.01);
});

test('FX insufficient bars yields no derived change', () => {
  const item = { price: 156.25, asOf: '2026-09-04T16:00:00Z', researchGroup: 'fx' };
  assert.equal(derivePreviousClose(item, [{ time: '2026-09-04', close: 156.25 }]), null);
});

const cryptoBars = [
  { time: '2026-09-04', close: 12449941 },
  { time: '2026-09-05', close: 12500018 },
  { time: '2026-09-06', close: 12498838 },
  { time: '2026-09-07', close: 12600000 }, // current UTC-day (unconfirmed, excluded)
];

test('Crypto excludes current UTC-day (unconfirmed) bar', () => {
  const item = { price: 12600000, researchGroup: 'crypto' };
  // today (UTC) is 2026-09-07, so 09-07 bar is excluded; prior confirmed = 09-06
  const prev = derivePreviousClose(item, cryptoBars);
  assert.equal(prev, 12498838);
});

test('Crypto UTC day cross uses latest confirmed day', () => {
  const clean = [
    { time: '2026-09-04', close: 12449941 },
    { time: '2026-09-05', close: 12500018 },
    { time: '2026-09-06', close: 12498838 },
  ];
  const item = { price: 12550000, researchGroup: 'crypto' };
  // today (UTC) is 2026-09-07, so the last confirmed day in `clean` is 09-06
  const prev = derivePreviousClose(item, clean);
  assert.equal(prev, 12498838);
});

test('Metals never derive a daily change (spot vs futures avoided)', () => {
  const metalBars = [
    { time: '2026-09-03', close: 4491.7 },
    { time: '2026-09-04', close: 4429.8 },
    { time: '2026-09-06', close: 4476.6 },
  ];
  const item = { price: 4476.6, researchGroup: 'metal' };
  assert.equal(derivePreviousClose(item, metalBars), null);
  assert.equal(changePercent(item, metalBars), null);
});

test('Backend-supplied previousClose (stocks) is preferred', () => {
  const item = { price: 7718.6, previousClose: 7747.71, researchGroup: 'equity' };
  assert.equal(derivePreviousClose(item, fxBars), 7747.71);
});

test('Bars load failure / empty keeps change as null', () => {
  const item = { price: 156.25, asOf: '2026-09-04T16:00:00Z', researchGroup: 'fx' };
  assert.equal(derivePreviousClose(item, null), null);
  assert.equal(derivePreviousClose(item, []), null);
});
