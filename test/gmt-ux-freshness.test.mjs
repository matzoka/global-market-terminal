// GMT-UX-02: freshness/health contract.
//   FRESH / STALE / UNKNOWN / UNAVAILABLE must be distinguishable, and a value
//   must never be presented as normal when it is stale, unknown, or unavailable.
import assert from 'node:assert/strict';
import test from 'node:test';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Per-URL stub so a single refresh can cover every configured provider.
function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.coinbase.com')) return json({ data: { amount: '1000' } });
    if (u.includes('frankfurter')) {
      const symbols = (new URL(u)).searchParams.get('symbols') || '';
      const rates = {};
      symbols.split(',').filter(Boolean).forEach((symbol) => { rates[symbol] = 1.5; });
      return json({ date: new Date().toISOString().slice(0, 10), rates });
    }
    // Yahoo Finance chart (indices + FTSE)
    const symbol = decodeURIComponent(u.split('/').pop().split('?')[0]);
    const nowSec = Math.floor(Date.now() / 1000);
    return json({ chart: { result: [{
      meta: { symbol, instrumentType: 'INDEX', regularMarketPrice: 100, regularMarketTime: nowSec },
      timestamp: [nowSec - 86_400, nowSec],
      indicators: { quote: [{ close: [99, 100] }] },
    }], error: null } });
  };
  return () => { globalThis.fetch = original; };
}

function fakeKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    async put(key, value) { store[key] = value; },
    async list() { return { keys: Object.keys(store).map((name) => ({ name })) }; },
    _store: store,
  };
}

const { freshnessFor, health, dashboard } = await import('../server/market-service.mjs');

test('freshnessFor classifies FRESH / STALE / UNKNOWN / UNAVAILABLE from the value lifecycle', () => {
  const now = Date.now();
  const fresh = { provider: 'ALPACA_IEX', status: 'PARTIAL_REALTIME', fetchedAt: new Date(now - 1000).toISOString() };
  const old = { provider: 'ALPACA_IEX', status: 'PARTIAL_REALTIME', fetchedAt: new Date(now - 10 * 60 * 1000).toISOString() };
  assert.equal(freshnessFor(fresh, now).freshness, 'FRESH');
  assert.equal(freshnessFor(old, now).freshness, 'STALE', 'a value past its TTL must not read as normal');
  assert.ok(freshnessFor(old, now).ageSeconds > 0);
  assert.equal(freshnessFor({ provider: 'ALPACA_IEX', status: 'UNAVAILABLE' }, now).freshness, 'UNAVAILABLE');
  assert.equal(freshnessFor({ provider: 'ALPACA_IEX', status: 'STALE' }, now).freshness, 'STALE');
  assert.equal(freshnessFor(null, now).freshness, 'UNKNOWN', 'never evaluated = UNKNOWN, not normal');
  assert.equal(freshnessFor({ provider: 'ALPACA_IEX', status: 'REALTIME' }, now).freshness, 'UNKNOWN', 'no timestamp cannot be proven fresh');
  // Provider TTL is respected: a 10-minute-old index quote is FRESH under the 30min TTL.
  assert.equal(freshnessFor({ provider: 'YAHOO_FINANCE_INDEX', status: 'UNVERIFIED', fetchedAt: new Date(now - 10 * 60 * 1000).toISOString() }, now).freshness, 'FRESH');
});

test('health() reports UNKNOWN (not normal, not unavailable) before any evaluation', async () => {
  const h = await health();
  assert.equal(h.instrumentCount, 43);
  assert.equal(h.freshness, 'UNKNOWN');
  assert.equal(h.freshnessCounts.UNKNOWN, 43);
  assert.equal(h.freshnessCounts.FRESH, 0);
});

test('dashboard exposes 43 instruments with freshness, expiry/age and a worst-value health summary', async () => {
  const restore = stubFetch();
  const now = new Date().toISOString();
  const metalQuote = (id) => ({ instrumentId: id, price: 1, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: now, receivedAt: now, fetchedAt: now });
  const kv = fakeKv({ metals_dev_spot: JSON.stringify({ attemptedAt: now, status: 'OK', quotes: { XAU: metalQuote('XAU'), XAG: metalQuote('XAG'), XPT: metalQuote('XPT'), XPD: metalQuote('XPD') } }) });
  try {
    const data = await dashboard(false, kv);
    assert.equal(data.instruments.length, 43, 'all 43 instruments must be delivered to the UI');
    assert.equal(data.health.total, 43);
    // 10 indices + 5 FX + 4 crypto + 4 metals are covered by free providers.
    assert.equal(data.health.counts.FRESH, 23, 'covered instruments are FRESH');
    // 19 US equities + ACWI (ETF) have no configured Alpaca key in tests -> UNAVAILABLE.
    assert.equal(data.health.counts.UNAVAILABLE, 20);
    assert.equal(data.health.status, 'UNAVAILABLE', 'worst value wins');
    const spx = data.instruments.find((item) => item.id === 'SPX');
    assert.equal(spx.quote.freshness, 'FRESH');
    assert.ok(spx.quote.expiresAt, 'expiry is exposed for UI trust decisions');
    assert.ok(Number.isInteger(spx.quote.ageSeconds));
    assert.ok(spx.quote.providerTtlSeconds > 0);
    assert.ok(data.instruments.every((item) => ['FRESH', 'STALE', 'UNKNOWN', 'UNAVAILABLE'].includes(item.quote.freshness)));
  } finally { restore(); }
});
