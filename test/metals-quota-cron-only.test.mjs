// P2-ALERT / METALS_DEV_SPOT quota redesign: Metals.Dev is acquired ONLY on the
// Cron path (refreshMetalsSpot) with a 12h KV cooldown. Dashboard + manual refresh
// MUST serve from the KV cache and never call the upstream API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { instruments, byId } from '../server/instruments.mjs';

// Metals.Dev provider must be enabled before market-service.mjs is first imported
// (its config is evaluated once at module load). Set the key up front.
process.env.METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || 'test-key';

// In-memory KV stub mirroring the Workers KV get/put interface.
function fakeKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    async put(k, v) { store[k] = v; },
    _store: store,
  };
}

// Stub globalThis.fetch to count Metals.Dev calls and return a successful batch.
function stubMetalsFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

const METALS_LATEST = 'https://api.metals.dev/v1/latest';
function metalsSuccessResponse() {
  return new Response(JSON.stringify({
    status: 'success',
    timestamp: '2026-09-08T12:00:00.000Z',
    metals: { gold: 2500.1, silver: 29.5, platinum: 980.2, palladium: 1200.3 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('refreshMetalsSpot acquires via upstream and persists OK snapshot to KV', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const kv = fakeKv();
  let calls = 0;
  const restore = stubMetalsFetch(async (url) => {
    calls++;
    assert.ok(String(url).startsWith(METALS_LATEST), 'only metals.dev latest endpoint is called');
    return metalsSuccessResponse();
  });
  try {
    const { refreshMetalsSpot } = await import('../server/market-service.mjs');
    const rec = await refreshMetalsSpot(kv);
    assert.equal(calls, 1, 'exactly one upstream call');
    assert.equal(rec.status, 'OK');
    assert.equal(Object.keys(rec.quotes).length, 4);
    const saved = JSON.parse(kv._store['metals_dev_spot']);
    assert.equal(saved.status, 'OK');
    assert.ok(saved.attemptedAt);
    assert.ok(saved.quotes.XAU.price > 0);
  } finally { restore(); }
});

test('refreshMetalsSpot does NOT re-call upstream inside the 12h cooldown (retry storm suppressed)', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const kv = fakeKv();
  let calls = 0;
  const restore = stubMetalsFetch(async () => { calls++; return metalsSuccessResponse(); });
  try {
    const { refreshMetalsSpot } = await import('../server/market-service.mjs');
    await refreshMetalsSpot(kv); // first call: writes KV with attemptedAt = now
    // Second immediate call must hit the cooldown and NOT call upstream.
    const rec = await refreshMetalsSpot(kv);
    assert.equal(calls, 1, 'upstream called only once within cooldown');
    assert.equal(rec.attemptedAt, JSON.parse(kv._store['metals_dev_spot']).attemptedAt);
  } finally { restore(); }
});

test('refreshMetalsSpot on failure persists FAILED with reason and still suppresses retries', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const kv = fakeKv();
  let calls = 0;
  const restore = stubMetalsFetch(async () => {
    calls++;
    return new Response(JSON.stringify({ status: 'error', error_code: 1203, error_message: 'monthly quota exceeded' }), { status: 400, headers: { 'content-type': 'application/json' } });
  });
  try {
    const { refreshMetalsSpot } = await import('../server/market-service.mjs');
    const rec1 = await refreshMetalsSpot(kv);
    assert.equal(rec1.status, 'FAILED');
    assert.match(rec1.reason, /provider_http_400/);
    const rec2 = await refreshMetalsSpot(kv); // within cooldown -> no new upstream call
    assert.equal(calls, 1, 'failure path also suppresses retry storm');
    assert.equal(rec2.status, 'FAILED');
  } finally { restore(); }
});

test('dashboard(refresh=1) never calls Metals.Dev upstream (serves from KV cache)', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  // Pre-seed KV with an OK snapshot so dashboard has something to render.
  const okRecord = {
    attemptedAt: '2026-09-08T12:00:00.000Z',
    status: 'OK',
    quotes: {
      XAU: { instrumentId: 'XAU', price: 2500.1, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
    },
  };
  const kv = fakeKv({ metals_dev_spot: JSON.stringify(okRecord) });
  let metalsCalls = 0;
  const restore = stubMetalsFetch(async (url) => {
    if (String(url).startsWith(METALS_LATEST)) metalsCalls++;
    return metalsSuccessResponse();
  });
  try {
    const { dashboard } = await import('../server/market-service.mjs');
    const dash = await dashboard(true, kv); // force refresh must NOT trigger metals fetch
    assert.equal(metalsCalls, 0, 'dashboard with force=1 must not call Metals.Dev');
    const xau = dash.instruments.find((i) => i.id === 'XAU');
    assert.ok(xau.quote, 'XAU quote present from cache');
    assert.equal(xau.quote.price, 2500.1);
    assert.equal(xau.quote.provider, 'METALS_DEV_SPOT');
  } finally { restore(); }
});

test('dashboard shows UNAVAILABLE with stored reason when KV cache is FAILED', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const failedRecord = { attemptedAt: '2026-09-08T12:00:00.000Z', status: 'FAILED', reason: 'provider_http_400' };
  const kv = fakeKv({ metals_dev_spot: JSON.stringify(failedRecord) });
  let metalsCalls = 0;
  const restore = stubMetalsFetch(async (url) => { if (String(url).startsWith(METALS_LATEST)) metalsCalls++; return metalsSuccessResponse(); });
  try {
    const { dashboard } = await import('../server/market-service.mjs');
    const dash = await dashboard(false, kv);
    assert.equal(metalsCalls, 0);
    for (const id of ['XAU', 'XAG', 'XPT', 'XPD']) {
      const q = dash.instruments.find((i) => i.id === id).quote;
      assert.equal(q.status, 'UNAVAILABLE');
      assert.equal(q.reason, 'provider_http_400');
      assert.equal(q.provider, 'METALS_DEV_SPOT');
    }
  } finally { restore(); }
});

test('health() does NOT call Metals.Dev upstream (serves from KV cache only)', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const kv = fakeKv();
  let metalsCalls = 0;
  const restore = stubMetalsFetch(async (url) => {
    if (String(url).startsWith(METALS_LATEST)) metalsCalls++;
    return metalsSuccessResponse();
  });
  try {
    const { health } = await import('../server/market-service.mjs');
    await health(kv);
    assert.equal(metalsCalls, 0, 'health must not call upstream');
  } finally { restore(); }
});

test('metals spot is excluded from live refreshQuotes provider loop', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  // A manual dashboard refresh must not produce a Metals.Dev upstream call even
  // when KV is empty (cold). It should render UNAVAILABLE without contacting upstream.
  const kv = fakeKv(); // empty cache
  let metalsCalls = 0;
  const restore = stubMetalsFetch(async (url) => { if (String(url).startsWith(METALS_LATEST)) metalsCalls++; return metalsSuccessResponse(); });
  try {
    const { dashboard } = await import('../server/market-service.mjs');
    const dash = await dashboard(true, kv);
    assert.equal(metalsCalls, 0, 'empty KV + force refresh still must not call Metals.Dev');
    const xau = dash.instruments.find((i) => i.id === 'XAU');
    assert.equal(xau.quote.status, 'UNAVAILABLE');
  } finally { restore(); }
});
