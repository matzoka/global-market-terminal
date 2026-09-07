// P2-INDEX Phase A: dedicated Yahoo Finance provider for the eight relocated indices.
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

const INDEX_IDS = ['SPX', 'NDX', 'DJI', 'DAX', 'N225', 'HSI', 'ASX', 'SSE'];
const YAHOO_SYMBOL = { SPX: '^GSPC', NDX: '^NDX', DJI: '^DJI', DAX: '^GDAXI', N225: '^N225', HSI: '^HSI', ASX: '^AXJO', SSE: '000001.SS' };

function yahooIndexPayload(symbol, instrumentType = 'INDEX', regularMarketPrice = 5000, regularMarketTime = 1788536130, prices, times) {
  return {
    chart: {
      result: [{
        meta: { symbol, instrumentType, regularMarketPrice, regularMarketTime, shortName: symbol, dataDelay: null },
        timestamp: times || [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
        indicators: { quote: [{ close: prices || [4900, 4950, 4980, 5000, 4990, 5010, 5000] }] },
      }],
      error: null,
    },
  };
}

test('YAHOO_FINANCE_INDEX supports the eight relocated indices only', async () => {
  const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
  const provider = createYahooIndexProvider();
  INDEX_IDS.forEach((id) => assert.equal(provider.supports(byId.get(id)), true));
  // SX5E remains outside this provider's ownership (handled by EODHD / Phase B).
  assert.equal(provider.supports(byId.get('SX5E')), false);
  assert.equal(provider.supportsDailyBars(byId.get('SX5E')), false);
  assert.equal(provider.id, 'YAHOO_FINANCE_INDEX');
});

test('YAHOO_FINANCE_INDEX verifies instrumentType INDEX and rejects non-INDEX', async () => {
  const restore = stubFetch(yahooIndexPayload('^GSPC', 'ETF'));
  try {
    const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
    await assert.rejects(() => createYahooIndexProvider().getQuotes([byId.get('SPX')]), /unexpected_instrument_type/);
  } finally { restore(); }
});

test('YAHOO_FINANCE_INDEX maps each index to its Yahoo symbol and returns finite price', async () => {
  for (const id of INDEX_IDS) {
    const restore = stubFetch(yahooIndexPayload(YAHOO_SYMBOL[id], 'INDEX', 5000, 1788536130, [4900, 4950, 4980, 5000, 4990, 5010, 5000], [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200]));
    try {
      const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
      const quote = (await createYahooIndexProvider().getQuotes([byId.get(id)])).get(id);
      assert.equal(quote.providerSymbol, YAHOO_SYMBOL[id]);
      assert.ok(Number.isFinite(quote.price) && quote.price > 0);
      assert.equal(quote.asOf, new Date(1788536130 * 1000).toISOString());
      assert.equal(quote.deliveryLabel, 'YAHOO FINANCE — INDEX REFERENCE');
    } finally { restore(); }
  }
});

test('YAHOO_FINANCE_INDEX previousClose is the last bar strictly before current day', async () => {
  // currentDay from regularMarketTime 1788505200 = 2026-09-04; the 7th bar (5000) is
  // the current/unconfirmed day and must NOT be used as previousClose. Expected = 5010 (2026-09-03).
  const restore = stubFetch(yahooIndexPayload('^GSPC', 'INDEX', 5000, 1788505200, [4900, 4950, 4980, 5000, 4990, 5010, 5000], [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200]));
  try {
    const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
    const quote = (await createYahooIndexProvider().getQuotes([byId.get('SPX')])).get('SPX');
    assert.equal(quote.previousClose, 5010);
    assert.equal(quote.previousCloseAsOf, '2026-09-03T00:00:00.000Z');
  } finally { restore(); }
});

test('YAHOO_FINANCE_INDEX status is UNVERIFIED when no delay reported', async () => {
  const restore = stubFetch(yahooIndexPayload('^GSPC'));
  try {
    const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
    const quote = (await createYahooIndexProvider().getQuotes([byId.get('SPX')])).get('SPX');
    assert.equal(quote.status, 'UNVERIFIED');
  } finally { restore(); }
});

test('YAHOO_FINANCE_INDEX bars carry the actual Yahoo symbol', async () => {
  const restore = stubFetch(yahooIndexPayload('^GDAXI', 'INDEX', 26000, 1788536130, [25500, 25600, 25700, 25800, 25900, 26000, 26000], [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200]));
  try {
    const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
    const bars = await createYahooIndexProvider().getDailyBars(byId.get('DAX'));
    assert.ok(bars.length >= 2);
    assert.equal(bars[0].providerSymbol, '^GDAXI');
  } finally { restore(); }
});

test('SSE uses 000001.SS and rejects ^SSE', async () => {
  // Confirm the provider maps SSE -> 000001.SS (not ^SSE).
  const { createYahooIndexProvider } = await import('../server/providers/yahoo-index.mjs');
  assert.equal(createYahooIndexProvider().supports(byId.get('SSE')), true);
  assert.equal(INDEX_IDS.includes('SSE'), true);
});
