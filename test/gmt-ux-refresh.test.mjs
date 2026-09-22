// GMT-UX-05: refresh hardening — single-flight, parallel providers, per-provider
// deadline, and partial success. Each test file gets a fresh module instance, so
// the FIRST dashboard() call is the one that actually refreshes providers.
process.env.FORCE_REFRESH_MIN_INTERVAL_MS = process.env.FORCE_REFRESH_MIN_INTERVAL_MS || '0';
process.env.PROVIDER_REFRESH_DEADLINE_MS = process.env.PROVIDER_REFRESH_DEADLINE_MS || '300';

import assert from 'node:assert/strict';
import test from 'node:test';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeKv() {
  const store = {};
  return {
    async get(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    async put(key, value) { store[key] = value; },
    async list() { return { keys: Object.keys(store).map((name) => ({ name })) }; },
    _store: store,
  };
}

const { dashboard } = await import('../server/market-service.mjs');

test('concurrent forced refreshes are single-flight, providers run in parallel, one hung provider times out, and healthy providers survive', { timeout: 20_000 }, async () => {
  const original = globalThis.fetch;
  const perUrl = new Map();
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    perUrl.set(u, (perUrl.get(u) || 0) + 1);
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      // Yield so overlapping provider calls are actually observable as concurrent.
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (u.includes('api.coinbase.com')) return json({ data: { amount: '1000' } });
      if (u.includes('frankfurter')) {
        const symbols = (new URL(u)).searchParams.get('symbols') || '';
        const rates = {};
        symbols.split(',').filter(Boolean).forEach((symbol) => { rates[symbol] = 1.5; });
        return json({ date: new Date().toISOString().slice(0, 10), rates });
      }
      const symbol = decodeURIComponent(u.split('/').pop().split('?')[0]);
      // One index symbol hangs forever -> the per-provider deadline must cut it off.
      if (symbol === '^GSPC') return new Promise(() => {});
      const nowSec = Math.floor(Date.now() / 1000);
      return json({ chart: { result: [{
        meta: { symbol, instrumentType: 'INDEX', regularMarketPrice: 100, regularMarketTime: nowSec },
        timestamp: [nowSec - 86_400, nowSec],
        indicators: { quote: [{ close: [99, 100] }] },
      }], error: null } });
    } finally {
      active--;
    }
  };
  const kv = fakeKv();
  const started = Date.now();
  try {
    const [a, b, c] = await Promise.all([dashboard(true, kv), dashboard(true, kv), dashboard(true, kv)]);
    const elapsed = Date.now() - started;
    // The hung Yahoo index request is abandoned by the deadline; without it the
    // whole refresh would block far longer than this.
    assert.ok(elapsed < 5000, `refresh must not hang on one provider (took ${elapsed}ms)`);
    // Single-flight: 3 concurrent dashboards must not multiply upstream requests.
    for (const [url, count] of perUrl) assert.equal(count, 1, `duplicate upstream request: ${url} (${count}x)`);
    assert.ok(maxActive >= 2, 'providers refresh concurrently, not serially');
    // Partial success: FTSE (separate provider) is usable while the index provider failed.
    assert.equal(a.health.total, 43);
    const ftse = a.instruments.find((item) => item.id === 'FTSE');
    const spx = a.instruments.find((item) => item.id === 'SPX');
    assert.equal(ftse.quote.freshness, 'FRESH', 'a healthy provider must stay usable');
    assert.notEqual(spx.quote.freshness, 'FRESH', 'the timed-out provider must not read as fresh');
    // The three responses are the same single refresh result.
    assert.equal(b.health.total, 43);
    assert.equal(c.instruments.length, 43);
  } finally {
    globalThis.fetch = original;
  }
});
