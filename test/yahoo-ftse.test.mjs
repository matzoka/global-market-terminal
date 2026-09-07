// P1-FTSE: dedicated Yahoo Finance provider for the FTSE 100 index only.
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

// Yahoo chart payload shape (7d / 1d) with a stale current-day bar to prove
// the provider never uses the unconfirmed current-day close as previousClose.
function yahooPayload({ instrumentType = 'INDEX', regularMarketPrice = 7500.5, regularMarketTime = 1788536130, prices, times }) {
  return {
    chart: {
      result: [{
        meta: {
          symbol: '^FTSE', instrumentType, regularMarketPrice, regularMarketTime,
          shortName: 'FTSE 100', dataDelay: null,
        },
        timestamp: times,
        indicators: { quote: [{ close: prices }] },
      }],
      error: null,
    },
  };
}

test('YAHOO_FINANCE_FTSE supports FTSE only', async () => {
  const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
  const provider = createYahooFtseProvider();
  assert.equal(provider.supports(byId.get('FTSE')), true);
  // Other indices must NOT be claimed by this provider.
  ['SPX', 'NDX', 'DAX', 'N225', 'HSI', 'SSE', 'ASX', 'SX5E'].forEach((id) => {
    assert.equal(provider.supports(byId.get(id)), false, id);
  });
  assert.equal(provider.supportsDailyBars(byId.get('FTSE')), true);
  assert.equal(provider.id, 'YAHOO_FINANCE_FTSE');
});

test('YAHOO_FINANCE_FTSE uses ^FTSE and verifies instrumentType INDEX', async () => {
  const restore = stubFetch(yahooPayload({
    prices: [7400, 7450, 7480, 7500, 7490, 7510, 7500.5],
    times: [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
  }));
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    const quote = (await createYahooFtseProvider().getQuotes([byId.get('FTSE')])).get('FTSE');
    assert.equal(quote.providerSymbol, '^FTSE');
    assert.equal(quote.deliveryLabel, 'YAHOO FINANCE — FTSE 100 INDEX');
    assert.equal(quote.currency, 'INDEX POINTS');
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE current price is finite and asOf derives from regularMarketTime', async () => {
  const restore = stubFetch(yahooPayload({
    regularMarketPrice: 7500.5,
    regularMarketTime: 1788536130, // 2026-09-04T...Z
    prices: [7400, 7450, 7480, 7500, 7490, 7510, 7500.5],
    times: [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
  }));
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    const quote = (await createYahooFtseProvider().getQuotes([byId.get('FTSE')])).get('FTSE');
    assert.ok(Number.isFinite(quote.price) && quote.price > 0);
    assert.equal(quote.asOf, new Date(1788536130 * 1000).toISOString());
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE previousClose is the last bar strictly before current day', async () => {
  // currentDay from regularMarketTime 1788505200 = 2026-09-04; daily bar for
  // 1788505200 (the 7th entry, 7500.5) is the current/unconfirmed day and must
  // NOT be used as previousClose. Expected previousClose = 7510 (2026-09-03).
  const restore = stubFetch(yahooPayload({
    regularMarketPrice: 7500.5,
    regularMarketTime: 1788505200,
    prices: [7400, 7450, 7480, 7500, 7490, 7510, 7500.5],
    times: [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
  }));
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    const quote = (await createYahooFtseProvider().getQuotes([byId.get('FTSE')])).get('FTSE');
    assert.equal(quote.previousClose, 7510);
    assert.equal(quote.previousCloseAsOf, '2026-09-03T00:00:00.000Z');
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE status is UNVERIFIED when no delay is reported', async () => {
  const restore = stubFetch(yahooPayload({
    prices: [7400, 7450, 7480, 7500, 7490, 7510, 7500.5],
    times: [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
  }));
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    const quote = (await createYahooFtseProvider().getQuotes([byId.get('FTSE')])).get('FTSE');
    assert.equal(quote.status, 'UNVERIFIED');
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE status is DELAYED when Yahoo reports a data delay', async () => {
  const payload = yahooPayload({
    prices: [7400, 7450, 7480, 7500, 7490, 7510, 7500.5],
    times: [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
  });
  payload.chart.result[0].meta.dataDelay = 15;
  const restore = stubFetch(payload);
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    const quote = (await createYahooFtseProvider().getQuotes([byId.get('FTSE')])).get('FTSE');
    assert.equal(quote.status, 'DELAYED');
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE rejects non-INDEX instrument types', async () => {
  const restore = stubFetch(yahooPayload({ instrumentType: 'ETF' }));
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    await assert.rejects(() => createYahooFtseProvider().getQuotes([byId.get('FTSE')]), /unexpected_instrument_type/);
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE bars are retrievable and cached downstream', async () => {
  const restore = stubFetch(yahooPayload({
    prices: [7400, 7450, 7480, 7500, 7490, 7510, 7500.5],
    times: [1787727600, 1787814000, 1787900400, 1788246000, 1788332400, 1788418800, 1788505200],
  }));
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    const bars = await createYahooFtseProvider().getDailyBars(byId.get('FTSE'));
    assert.ok(bars.length >= 2);
    assert.ok(bars.every((bar) => Number.isFinite(bar.close) && bar.close > 0));
  } finally { restore(); }
});

test('YAHOO_FINANCE_FTSE failure isolates to FTSE and leaves other indices routed', async () => {
  const restore = stubFetch(null, { httpStatus: 503 });
  try {
    const { createYahooFtseProvider } = await import('../server/providers/yahoo-ftse.mjs');
    await assert.rejects(() => createYahooFtseProvider().getQuotes([byId.get('FTSE')]), /provider_http_503/);
  } finally { restore(); }
  // EODHD routing for other indices must remain unaffected (no overlap).
  const { createEodhdProvider } = await import('../server/providers/eodhd.mjs');
  assert.equal(createEodhdProvider('token').supports(byId.get('SPX')), true);
});
