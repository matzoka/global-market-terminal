// GMT-UX-05: forced-refresh limiting. ?refresh=1 must not be able to burn free
// provider quotas on every click; within FORCE_REFRESH_MIN_INTERVAL_MS a forced
// refresh is downgraded to the normal cache window.
process.env.FORCE_REFRESH_MIN_INTERVAL_MS = process.env.FORCE_REFRESH_MIN_INTERVAL_MS || '60000';

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

test('a second forced refresh inside the interval does not trigger new upstream calls', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    const u = String(url);
    if (u.includes('api.coinbase.com')) return json({ data: { amount: '1000' } });
    if (u.includes('frankfurter')) {
      const symbols = (new URL(u)).searchParams.get('symbols') || '';
      const rates = {};
      symbols.split(',').filter(Boolean).forEach((symbol) => { rates[symbol] = 1.5; });
      return json({ date: new Date().toISOString().slice(0, 10), rates });
    }
    const symbol = decodeURIComponent(u.split('/').pop().split('?')[0]);
    const nowSec = Math.floor(Date.now() / 1000);
    return json({ chart: { result: [{
      meta: { symbol, instrumentType: 'INDEX', regularMarketPrice: 100, regularMarketTime: nowSec },
      timestamp: [nowSec - 86_400, nowSec],
      indicators: { quote: [{ close: [99, 100] }] },
    }], error: null } });
  };
  const kv = fakeKv();
  try {
    await dashboard(true, kv);
    const afterFirst = calls;
    assert.ok(afterFirst > 0, 'the first forced refresh does hit providers');
    await dashboard(true, kv); // inside 60s -> downgraded, cache still valid
    assert.equal(calls, afterFirst, 'forced refresh abuse is limited');
    await dashboard(false, kv);
    assert.equal(calls, afterFirst, 'non-forced refresh inside the cache window is a no-op');
  } finally {
    globalThis.fetch = original;
  }
});
