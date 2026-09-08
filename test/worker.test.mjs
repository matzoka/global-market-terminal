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
  const h = health();
  assert.equal(typeof h.unavailableCount, 'number');
  assert.equal(typeof h.staleCount, 'number');
  assert.equal(typeof h.degraded, 'boolean');
  assert.equal(h.instrumentCount, 43);
  // Existing fields retained for backward compatibility.
  assert.ok('provider' in h);
  assert.ok('quoteCacheSeconds' in h);
});
