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

// Regression: refreshQuotes() must NOT overwrite metals with
// not_covered_by_configured_sources, and refreshAndInspect() must prefer the KV
// cache over any synthetic metal snapshot so P2-ALERT recovers when quota resets.
function fakeKvWithList(initial = {}) {
  const store = { ...initial };
  return {
    async get(k, opts) {
      if (!Object.prototype.hasOwnProperty.call(store, k)) return null;
      const raw = store[k];
      if (opts && opts.type === 'json') { try { return JSON.parse(raw); } catch { return null; } }
      return raw;
    },
    async put(k, v) { store[k] = v; },
    async list() { return { keys: Object.keys(store).map((name) => ({ name })) }; },
    _store: store,
  };
}

const okRecord = {
  attemptedAt: '2026-09-08T12:00:00.000Z',
  status: 'OK',
  quotes: {
    XAU: { instrumentId: 'XAU', price: 2500.1, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
    XAG: { instrumentId: 'XAG', price: 29.5, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
    XPT: { instrumentId: 'XPT', price: 980.2, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
    XPD: { instrumentId: 'XPD', price: 1200.3, currency: 'USD', status: 'DELAYED', provider: 'METALS_DEV_SPOT', asOf: '2026-09-08T12:00:00.000Z', receivedAt: '2026-09-08T12:00:00.000Z', fetchedAt: '2026-09-08T12:00:00.000Z', reason: null },
  },
};

test('refreshAndInspect prefers KV OK cache; metals never not_covered_by_configured_sources', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const kv = fakeKvWithList({ metals_dev_spot: JSON.stringify(okRecord) });
  let metalsCalls = 0;
  const restore = stubMetalsFetch(async (url) => { if (String(url).startsWith(METALS_LATEST)) metalsCalls++; return metalsSuccessResponse(); });
  try {
    const { refreshAndInspect } = await import('../server/market-service.mjs');
    const rows = await refreshAndInspect(kv);
    assert.equal(metalsCalls, 0, 'refreshAndInspect must not call upstream');
    for (const id of ['XAU', 'XAG', 'XPT', 'XPD']) {
      const r = rows.find((x) => x.id === id);
      assert.equal(r.status, 'DELAYED', `${id} must reflect KV OK cache, not UNAVAILABLE`);
      assert.notEqual(r.reason, 'not_covered_by_configured_sources', `${id} must not be not_covered`);
    }
  } finally { restore(); }
});

test('pre-existing synthetic metal snapshot does NOT override KV OK cache', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const kv = fakeKvWithList({ metals_dev_spot: JSON.stringify(okRecord) });
  // refreshQuotes runs (metals excluded from its provider loop) but refreshAndInspect
  // must still prefer the KV OK cache for metals, never a snapshot it may leave.
  const restore = stubMetalsFetch(async () => metalsSuccessResponse());
  try {
    const { refreshAndInspect } = await import('../server/market-service.mjs');
    const rows = await refreshAndInspect(kv);
    for (const id of ['XAU', 'XAG', 'XPT', 'XPD']) {
      assert.equal(rows.find((x) => x.id === id).status, 'DELAYED', `${id} KV OK wins over any snapshot`);
    }
  } finally { restore(); }
});

test('refreshAndInspect reports 4 metals UNAVAILABLE when KV status=FAILED', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const failedRecord = { attemptedAt: '2026-09-08T12:00:00.000Z', status: 'FAILED', reason: 'provider_http_400' };
  const kv = fakeKvWithList({ metals_dev_spot: JSON.stringify(failedRecord) });
  const restore = stubMetalsFetch(async () => metalsSuccessResponse());
  try {
    const { refreshAndInspect } = await import('../server/market-service.mjs');
    const rows = await refreshAndInspect(kv);
    for (const id of ['XAU', 'XAG', 'XPT', 'XPD']) {
      const r = rows.find((x) => x.id === id);
      assert.equal(r.status, 'UNAVAILABLE', `${id} FAILED cache -> UNAVAILABLE`);
      assert.equal(r.reason, 'provider_http_400');
    }
  } finally { restore(); }
});

test('scheduled path recovers metals when KV OK (RECOVERED state possible)', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  // Seed KV with a prior CRITICAL incident so we can verify recovery transition.
  // Note: evaluateAlerts keys incidents as `provider|reason` (severity is stored
  // inside the record, not in the key), so the seed key matches that form.
  const priorIncident = {
    status: 'UNAVAILABLE', reason: 'provider_http_400', consecutiveFailures: 3,
    firstDetectedAt: '2026-09-01T00:00:00.000Z', lastDetectedAt: '2026-09-08T00:00:00.000Z',
    lastAlertAt: '2026-09-08T00:00:00.000Z', severity: 'CRITICAL',
    affected: ['XAU', 'XAG', 'XPT', 'XPD'], alerted: true, recoveryNotified: false,
  };
  const kv = fakeKvWithList({
    'METALS_DEV_SPOT|provider_http_400': JSON.stringify(priorIncident),
    metals_dev_spot: JSON.stringify(okRecord),
  });
  const restore = stubMetalsFetch(async () => metalsSuccessResponse());
  try {
    const { refreshMetalsSpot, refreshAndInspect } = await import('../server/market-service.mjs');
    const { evaluateAlerts } = await import('../server/alert-service.mjs');
    // Cron path: refreshMetalsSpot (writes OK), then inspect, then evaluate.
    await refreshMetalsSpot(kv);
    const rows = await refreshAndInspect(kv);
    const result = await evaluateAlerts(rows, { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: null }, {});
    // No abnormal metal rows -> the prior incident is recovered (state transition).
    assert.equal(result.alertsSent, 0, 'no new CRITICAL when KV OK');
    // Stored incident must be marked RECOVERED (recovered count needs a webhook;
    // the state transition itself is the guarantee we assert here).
    const stored = JSON.parse(kv._store['METALS_DEV_SPOT|provider_http_400']);
    assert.equal(stored.status, 'RECOVERED', 'prior incident transitions to RECOVERED on KV OK');
    assert.equal(stored.recoveryNotified, true);
  } finally { restore(); }
});

test('scheduled path keeps CRITICAL when KV FAILED (no false recovery)', async () => {
  process.env.METALS_DEV_API_KEY = 'test-key';
  const priorIncident = {
    status: 'UNAVAILABLE', reason: 'provider_http_400', consecutiveFailures: 3,
    firstDetectedAt: '2026-09-01T00:00:00.000Z', lastDetectedAt: '2026-09-08T00:00:00.000Z',
    lastAlertAt: '2026-09-08T00:00:00.000Z', severity: 'CRITICAL',
    affected: ['XAU', 'XAG', 'XPT', 'XPD'], alerted: true, recoveryNotified: false,
  };
  const failedRecord = { attemptedAt: '2026-09-08T12:00:00.000Z', status: 'FAILED', reason: 'provider_http_400' };
  const kv = fakeKvWithList({
    'METALS_DEV_SPOT|provider_http_400': JSON.stringify(priorIncident),
    metals_dev_spot: JSON.stringify(failedRecord),
  });
  const restore = stubMetalsFetch(async () => metalsSuccessResponse());
  try {
    const { refreshMetalsSpot, refreshAndInspect } = await import('../server/market-service.mjs');
    const { evaluateAlerts } = await import('../server/alert-service.mjs');
    await refreshMetalsSpot(kv);
    const rows = await refreshAndInspect(kv);
    const result = await evaluateAlerts(rows, { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: null }, {});
    // Metals still UNAVAILABLE -> incident stays active (no recovery).
    assert.equal(result.recovered, 0, 'FAILED cache must NOT recover the incident');
    const stored = JSON.parse(kv._store['METALS_DEV_SPOT|provider_http_400']);
    assert.equal(stored.status, 'UNAVAILABLE', 'incident remains UNAVAILABLE on FAILED cache');
  } finally { restore(); }
});
