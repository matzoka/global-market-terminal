// Worker entry: scheduled handler must not break fetch/dashboard and must
// isolate alert failures. Lightweight integration test (no real providers).
import assert from 'node:assert/strict';
import test from 'node:test';

test('worker exports fetch and scheduled handlers', async () => {
  const { default: worker } = await import('../server/worker.mjs');
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
});

test('scheduled handler runs without throwing even with no bindings', async () => {
  const { default: worker } = await import('../server/worker.mjs');
  // No GMT_ALERT_STATE / webhook -> evaluation skipped, no throw.
  let threw = false;
  try {
    await worker.scheduled({}, {}, {});
  } catch { threw = true; }
  assert.equal(threw, false, 'scheduled must never throw');
});

test('scheduled handler isolates alert errors (does not propagate)', async () => {
  // Force evaluateAlerts to throw by giving a broken KV whose get rejects.
  const brokenKv = {
    async get() { throw new Error('kv down'); },
    async put() { throw new Error('kv down'); },
    async list() { throw new Error('kv down'); },
  };
  const { default: worker } = await import('../server/worker.mjs');
  let threw = false;
  try {
    // refreshAndInspect will attempt real provider fetches; stub them to avoid
    // network. The point is that any downstream alert error is absorbed.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ chart: { result: [{ meta: { symbol: 'x', instrumentType: 'INDEX', regularMarketPrice: 1, regularMarketTime: 1788536130 }, timestamp: [1787727600], indicators: { quote: [{ close: [1] }] } }], error: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      await worker.scheduled({}, { GMT_ALERT_STATE: brokenKv }, {});
    } catch { threw = true; }
    finally { globalThis.fetch = originalFetch; }
  } catch { threw = true; }
  assert.equal(threw, false, 'alert failure must be isolated from the scheduler');
});

test('health() exposes unavailableCount / staleCount / degraded', async () => {
  const { health } = await import('../server/market-service.mjs');
  const h = await health();
  assert.equal(typeof h.unavailableCount, 'number');
  assert.equal(typeof h.staleCount, 'number');
  assert.equal(typeof h.degraded, 'boolean');
  assert.equal(h.instrumentCount, 43);
  // Existing fields retained for backward compatibility.
  assert.ok('provider' in h);
  assert.ok('quoteCacheSeconds' in h);
});

// Regression: /api/v1/health must pass env.GMT_ALERT_STATE to health() so a cold
// Worker isolate reads Metals.Dev state from KV instead of counting metals as
// UNAVAILABLE. Validates the real request path end-to-end.
function fakeKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    async put(k, v) { store[k] = v; },
    _store: store,
  };
}

test('/api/v1/health passes GMT_ALERT_STATE KV and reads metals from it (cold isolate)', async () => {
  process.env.METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || 'test-key';
  let metalsCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.metals.dev/v1/latest')) metalsCalls++;
    return new Response(JSON.stringify({ chart: { result: [{ meta: { symbol: 'x', instrumentType: 'INDEX', regularMarketPrice: 1, regularMarketTime: 1788536130 }, timestamp: [1787727600], indicators: { quote: [{ close: [1] }] } }], error: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: worker } = await import('../server/worker.mjs');
    const okQuotes = {
      XAU: { instrumentId: 'XAU', price: 2500.1, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
      XAG: { instrumentId: 'XAG', price: 29.5, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
      XPT: { instrumentId: 'XPT', price: 980.2, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
      XPD: { instrumentId: 'XPD', price: 1200.3, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
    };
    // OK cache: 4 metals present -> should NOT add to unavailableCount vs FAILED.
    const okRecord = { attemptedAt: '2026-09-08T12:00:00.000Z', status: 'OK', quotes: okQuotes };
    const kvOk = fakeKv({ metals_dev_spot: JSON.stringify(okRecord) });
    const resOk = await worker.fetch(new Request('https://x/api/v1/health'), { GMT_ALERT_STATE: kvOk }, {});
    const bodyOk = await resOk.json();
    assert.equal(metalsCalls, 0, 'health path must not call Metals.Dev upstream');

    // FAILED cache: 4 metals unavailable -> must add exactly 4 vs OK cache.
    const failedRecord = { attemptedAt: '2026-09-08T12:00:00.000Z', status: 'FAILED', reason: 'provider_http_400' };
    const kvFail = fakeKv({ metals_dev_spot: JSON.stringify(failedRecord) });
    const resFail = await worker.fetch(new Request('https://x/api/v1/health'), { GMT_ALERT_STATE: kvFail }, {});
    const bodyFail = await resFail.json();
    assert.equal(metalsCalls, 0, 'health path still must not call upstream on FAILED cache');
    // Delta between FAILED and OK cache must be exactly the 4 metals (any other
    // instruments' state is identical in both runs, so it cancels out).
    assert.equal(bodyFail.unavailableCount - bodyOk.unavailableCount, 4, 'FAILED cache adds exactly 4 metals unavailable vs OK cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

