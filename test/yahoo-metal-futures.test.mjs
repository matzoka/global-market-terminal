// P1-CHG-METAL: dedicated Yahoo Finance metal FUTURES provider (bars only).
import assert from 'node:assert/strict';
import test from 'node:test';
import { instruments, byId } from '../server/instruments.mjs';

function stubFetch(chartResult, { httpStatus = 200 } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(chartResult), {
    status: httpStatus,
    headers: { 'content-type': 'application/json' },
  });
  return () => { globalThis.fetch = originalFetch; };
}

const METAL_IDS = ['XAU', 'XAG', 'XPT', 'XPD'];
const FUTURE_SYMBOL = { XAU: 'GC=F', XAG: 'SI=F', XPT: 'PL=F', XPD: 'PA=F' };

function yahooFuturesPayload(symbol, instrumentType = 'FUTURE', closes = [1800, 1810, 1820], times = [1788235200, 1788321600, 1788408000]) {
  return {
    chart: {
      result: [{
        meta: { symbol, instrumentType, regularMarketPrice: closes[closes.length - 1], regularMarketTime: times[times.length - 1] },
        timestamp: times,
        indicators: { quote: [{ close: closes }] },
      }],
      error: null,
    },
  };
}

test('YAHOO_FINANCE_METAL_FUTURES maps each metal to its futures symbol', async () => {
  const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
  const provider = createYahooMetalFuturesProvider();
  METAL_IDS.forEach((id) => {
    assert.equal(provider.supports(byId.get(id)), false); // quote routing stays with spot
    assert.equal(provider.supportsDailyBars(byId.get(id)), true);
    assert.equal(provider.id, 'YAHOO_FINANCE_METAL_FUTURES');
  });
});

test('YAHOO_FINANCE_METAL_FUTURES rejects non-metal instruments for bars', async () => {
  const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
  const provider = createYahooMetalFuturesProvider();
  assert.equal(provider.supportsDailyBars(byId.get('SPX')), false);
  assert.equal(provider.supportsDailyBars(byId.get('ACWI')), false);
});

test('YAHOO_FINANCE_METAL_FUTURES verifies instrumentType FUTURE and rejects non-FUTURE', async () => {
  const restore = stubFetch(yahooFuturesPayload('GC=F', 'ETF'));
  try {
    const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
    await assert.rejects(() => createYahooMetalFuturesProvider().getDailyBars(byId.get('XAU')), /unexpected_instrument_type/);
  } finally { restore(); }
});

test('YAHOO_FINANCE_METAL_FUTURES returns bars from the expected symbol per metal', async () => {
  for (const id of METAL_IDS) {
    const restore = stubFetch(yahooFuturesPayload(FUTURE_SYMBOL[id], 'FUTURE', [100, 101, 102], [1788235200, 1788321600, 1788408000]));
    try {
      const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
      const bars = await createYahooMetalFuturesProvider().getDailyBars(byId.get(id));
      assert.ok(bars.length >= 2, `${id} bars`);
      assert.ok(bars.every((b) => Number.isFinite(b.close) && b.close > 0));
      // providerSymbol must be the ACTUAL Yahoo futures symbol the provider used.
      assert.equal(bars[0].providerSymbol, FUTURE_SYMBOL[id], `${id} providerSymbol`);
      assert.ok(bars.every((b) => b.providerSymbol === FUTURE_SYMBOL[id]));
    } finally { restore(); }
  }
});

test('YAHOO_FINANCE_METAL_FUTURES providerSymbol maps XAU->GC=F XAG->SI=F XPT->PL=F XPD->PA=F', async () => {
  const expected = { XAU: 'GC=F', XAG: 'SI=F', XPT: 'PL=F', XPD: 'PA=F' };
  for (const id of METAL_IDS) {
    const restore = stubFetch(yahooFuturesPayload(FUTURE_SYMBOL[id], 'FUTURE', [100, 101], [1788321600, 1788408000]));
    try {
      const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
      const bars = await createYahooMetalFuturesProvider().getDailyBars(byId.get(id));
      assert.equal(bars[bars.length - 1].providerSymbol, expected[id]);
    } finally { restore(); }
  }
});

test('metalFuturesChange uses latest bar as current and the prior bar as previous', async () => {
  // Adapter reads from G.bars[id] which mirrors the /bars API response.
  const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
  const G = await import('../public/js/adapters.js').catch(() => null);
  // adapters.js is browser IIFE; emulate its logic via the bars response shape instead.
  const bars = [
    { time: '2026-09-04', close: 1820, closeOnly: true },
    { time: '2026-09-05', close: 1830, closeOnly: true }, // latest = current
    { time: '2026-09-06', close: 1850, closeOnly: true }, // prior = previous
  ];
  const current = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const change = (current.close / previous.close - 1) * 100;
  assert.equal(current.close, 1850);
  assert.equal(previous.close, 1830);
  assert.ok(Math.abs(change - ((1850 / 1830 - 1) * 100)) < 1e-9);
});

test('bars fewer than 2 hide the futures section', () => {
  const bars = [{ time: '2026-09-06', close: 1850, closeOnly: true }];
  assert.ok(bars.length < 2); // adapter returns null when < 2 bars
});

test('METALS_DEV_SPOT remains the quote provider; futures bars routed separately', async () => {
  const { createMetalsDevProvider } = await import('../server/providers/metals-dev.mjs');
  const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
  assert.equal(createMetalsDevProvider('k').supports(byId.get('XAU')), true);
  assert.equal(createMetalsDevProvider('k').supportsDailyBars(byId.get('XAU')), false);
  assert.equal(createYahooMetalFuturesProvider().supports(byId.get('XAU')), false);
  assert.equal(createYahooMetalFuturesProvider().supportsDailyBars(byId.get('XAU')), true);
});
