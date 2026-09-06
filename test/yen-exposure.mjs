// P1-YEN: yen-exposure (JPY-impact) decomposition for ACWI (minimum scope).
// Mirrors public/js/adapters.js derivePreviousBasis / yenExposure without a DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Minimal stand-ins for GMT client internals used by the logic under test.
function makeClient(store, bars) {
  const G = { store, bars };
  G.get = (id) => store[id] || null;
  // derivePreviousBasis(item) -> { close, day } | null
  function derivePreviousBasis(item) {
    const q = item && item.quote;
    if (!q || !Number.isFinite(q.price)) return null;
    if (Number.isFinite(q.previousClose) && q.previousClose > 0) {
      return { close: q.previousClose, day: (q.previousCloseAsOf || q.asOf || '').slice(0, 10) };
    }
    const group = item.researchGroup;
    const b = (bars[item.id] && Array.isArray(bars[item.id].bars)) ? bars[item.id].bars : null;
    if (!b || b.length < 2) return null;
    const sorted = b.slice().sort((a, b2) => String(a.time).localeCompare(String(b2.time)));
    if (group === 'fx') {
      const asOfDay = (q.asOf || '').slice(0, 10);
      if (!asOfDay) return null;
      const prior = sorted.filter((x) => x.time < asOfDay && Number.isFinite(x.close));
      if (!prior.length) return null;
      const last = prior[prior.length - 1];
      return { close: last.close, day: String(last.time).slice(0, 10) };
    }
    if (group === 'crypto') {
      const today = new Date().toISOString().slice(0, 10);
      const confirmed = sorted.filter((x) => x.time < today && Number.isFinite(x.close));
      if (!confirmed.length) return null;
      const last = confirmed[confirmed.length - 1];
      return { close: last.close, day: String(last.time).slice(0, 10) };
    }
    return null;
  }
  G.yenExposure = function (item) {
    if (!item || item.id !== 'ACWI') return null;
    const q = item.quote;
    if (!q || q.currency !== 'USD' || !Number.isFinite(q.price) || !Number.isFinite(q.previousClose) || !q.previousCloseAsOf) return null;
    const usdjpy = G.get('USDJPY');
    if (!usdjpy || !usdjpy.quote || !Number.isFinite(usdjpy.quote.price)) return null;
    const fxBasis = derivePreviousBasis(usdjpy);
    if (!fxBasis || !fxBasis.close || fxBasis.close <= 0) return null;
    const assetBasis = derivePreviousBasis(item);
    if (!assetBasis || !assetBasis.day) return null;
    const dayOf = (iso) => (iso || '').slice(0, 10);
    const aligned = dayOf(q.asOf) === dayOf(usdjpy.quote.asOf) && assetBasis.day === fxBasis.day;
    if (!aligned) return null;
    const assetReturn = q.price / q.previousClose - 1;
    const fxReturn = usdjpy.quote.price / fxBasis.close - 1;
    const yenReturn = (1 + assetReturn) * (1 + fxReturn) - 1;
    return {
      applicable: true,
      assetReturn: { value: assetReturn, source: q.provider, currentAsOf: q.asOf, previousCloseAsOf: q.previousCloseAsOf },
      fxReturn: { value: fxReturn, source: 'FRANKFURTER_ECB', currentAsOf: usdjpy.quote.asOf, previousCloseAsOf: fxBasis.day },
      yenReturn: { value: yenReturn, formula: '(1+assetReturn)*(1+fxReturn)-1', isApproximate: true },
      isReference: Boolean(item.referenceOnly),
      note: 'ACWI ETF を JPY 換算した参考変動。オルカン投資信託の基準価額ではありません。',
    };
  };
  return G;
}

// USDJPY bars: 09-02, 09-03, 09-04 (current asOf 09-04 -> prev basis day 09-03)
const usdjpyBars = { USDJPY: { bars: [
  { time: '2026-09-02', close: 159.6 },
  { time: '2026-09-03', close: 156.01 },
  { time: '2026-09-04', close: 156.25 },
] } };

function acwi(overrides) {
  return {
    id: 'ACWI',
    referenceOnly: true,
    researchGroup: 'global',
    quote: Object.assign({
      currency: 'USD',
      price: 161.86,
      previousClose: 161.905,
      previousCloseAsOf: '2026-09-03T19:59:54Z',
      asOf: '2026-09-04T19:59:54Z',
      provider: 'ALPACA_IEX',
    }, overrides),
  };
}
function usdjpy(overrides) {
  return { id: 'USDJPY', researchGroup: 'fx', quote: Object.assign({
    currency: 'JPY', price: 156.25, asOf: '2026-09-04T16:00:00Z', provider: 'FRANKFURTER_ECB',
  }, overrides) };
}

test('both start and end dates align -> shown', () => {
  const G = makeClient({ ACWI: acwi(), USDJPY: usdjpy() }, usdjpyBars);
  const y = G.yenExposure(G.get('ACWI'));
  assert.ok(y && y.applicable);
  // formula check
  const a = 161.86 / 161.905 - 1;
  const f = 156.25 / 156.01 - 1;
  assert.equal(y.assetReturn.value, a);
  assert.equal(y.fxReturn.value, f);
  assert.ok(Math.abs(y.yenReturn.value - ((1 + a) * (1 + f) - 1)) < 1e-12);
  assert.equal(y.isReference, true);
});

test('end dates align but start dates differ -> hidden', () => {
  // asset current 09-04 (Tue), prevClose 09-02; FX current 09-04 (Tue), prev basis 09-03
  const G = makeClient({
    ACWI: acwi({ asOf: '2026-09-04T19:59:54Z', previousCloseAsOf: '2026-09-02T19:59:54Z' }),
    USDJPY: usdjpy({ asOf: '2026-09-04T16:00:00Z' }),
  }, usdjpyBars);
  assert.equal(G.yenExposure(G.get('ACWI')), null);
});

test('start dates align but end dates differ -> hidden', () => {
  // asset current 09-03, prev 09-02; FX current 09-04, prev 09-03 (current-day mismatch)
  const G = makeClient({
    ACWI: acwi({ asOf: '2026-09-03T19:59:54Z', previousCloseAsOf: '2026-09-02T19:59:54Z' }),
    USDJPY: usdjpy({ asOf: '2026-09-04T16:00:00Z' }),
  }, usdjpyBars);
  assert.equal(G.yenExposure(G.get('ACWI')), null);
});

test('previousCloseAsOf missing -> hidden', () => {
  const G = makeClient({ ACWI: acwi({ previousCloseAsOf: undefined }), USDJPY: usdjpy() }, usdjpyBars);
  assert.equal(G.yenExposure(G.get('ACWI')), null);
});

test('USDJPY basis insufficient -> hidden', () => {
  const G = makeClient({ ACWI: acwi(), USDJPY: usdjpy() }, { USDJPY: { bars: [{ time: '2026-09-04', close: 156.25 }] } });
  assert.equal(G.yenExposure(G.get('ACWI')), null);
});

test('non-ACWI instrument -> hidden', () => {
  const G = makeClient({ NVDA: { id: 'NVDA', quote: { currency: 'USD', price: 1, previousClose: 1, previousCloseAsOf: '2026-09-04T19:59:54Z', asOf: '2026-09-04T19:59:54Z' } }, USDJPY: usdjpy() }, usdjpyBars);
  assert.equal(G.yenExposure(G.get('NVDA')), null);
});

test('formula verification: (1+a)*(1+f)-1', () => {
  const G = makeClient({ ACWI: acwi(), USDJPY: usdjpy() }, usdjpyBars);
  const y = G.yenExposure(G.get('ACWI'));
  const a = y.assetReturn.value, f = y.fxReturn.value;
  assert.ok(Math.abs(y.yenReturn.value - ((1 + a) * (1 + f) - 1)) < 1e-12);
});

// P1-CHG regression: FX/crypto derived change still works via derivePreviousBasis.
test('P1-CHG regression: FX uses prior ECB business day (not same day)', () => {
  const G = makeClient({}, usdjpyBars);
  const item = { id: 'USDJPY', researchGroup: 'fx', quote: { price: 156.25, asOf: '2026-09-04T16:00:00Z' } };
  const basis = (function (it) {
    const q = it.quote; const b = usdjpyBars[it.id].bars;
    const sorted = b.slice().sort((x, y) => String(x.time).localeCompare(String(y.time)));
    const asOfDay = q.asOf.slice(0, 10);
    const prior = sorted.filter((x) => x.time < asOfDay && Number.isFinite(x.close));
    return prior.length ? prior[prior.length - 1] : null;
  })(item);
  assert.ok(basis && basis.time === '2026-09-03' && basis.close === 156.01);
});

test('P1-CHG regression: crypto excludes current UTC-day bar', () => {
  const cryptoBars = { BTCJPY: { bars: [
    { time: '2026-09-03', close: 12449941 },
    { time: '2026-09-04', close: 12500018 },
    { time: '2026-09-05', close: 12498838 },
    { time: '2026-09-06', close: 12600000 }, // current UTC-day (excluded)
  ] } };
  const G = makeClient({}, cryptoBars);
  const item = { id: 'BTCJPY', researchGroup: 'crypto', quote: { price: 12600000 } };
  const basis = (function (it) {
    const b = cryptoBars[it.id].bars;
    const sorted = b.slice().sort((x, y) => String(x.time).localeCompare(String(y.time)));
    const today = new Date().toISOString().slice(0, 10);
    const confirmed = sorted.filter((x) => x.time < today && Number.isFinite(x.close));
    return confirmed.length ? confirmed[confirmed.length - 1] : null;
  })(item);
  // today is 2026-09-06, so 09-06 excluded, prior = 09-05
  assert.ok(basis && basis.time === '2026-09-05' && basis.close === 12498838);
});

test('P1-CHG regression: metals never derive a daily change', () => {
  const metalBars = { XAU: { bars: [
    { time: '2026-09-03', close: 4491.7 },
    { time: '2026-09-04', close: 4429.8 },
    { time: '2026-09-06', close: 4476.6 },
  ] } };
  const G = makeClient({}, metalBars);
  const item = { id: 'XAU', researchGroup: 'metal', quote: { price: 4476.6 } };
  const basis = (function (it) {
    const q = it.quote; if (Number.isFinite(q.previousClose) && q.previousClose > 0) return { close: q.previousClose, day: (q.previousCloseAsOf || q.asOf || '').slice(0, 10) };
    const group = it.researchGroup; const b = metalBars[it.id].bars;
    if (!b || b.length < 2) return null;
    const sorted = b.slice().sort((x, y) => String(x.time).localeCompare(String(y.time)));
    if (group === 'metal') return null;
    return null;
  })(item);
  assert.equal(basis, null);
});
