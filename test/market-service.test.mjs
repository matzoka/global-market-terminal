import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { instruments, byId } from '../server/instruments.mjs';

test('instrument registry never contains a synthetic price source', () => {
  assert.equal(instruments.length, 43);
  assert.ok(instruments.every((item) => !Object.hasOwn(item, 'synthetic')));
});

test('free Alpaca adapter is explicitly limited to U.S. listed equities', async () => {
  const { createAlpacaProvider } = await import('../server/providers/alpaca.mjs');
  const provider = createAlpacaProvider('unused-for-this-test', 'unused-for-this-test');
  assert.equal(provider.supports(byId.get('AAPL')), true);
  assert.equal(provider.supports(byId.get('SPX')), false);
  assert.equal(provider.supports(byId.get('XAU')), false);
});

test('Alpaca quote exposes a verified IEX daily-dollar-volume area metric', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    AAPL: { latestTrade: { p: 200, t: '2026-08-15T15:00:00Z' }, dailyBar: { c: 198, v: 1_500_000, t: '2026-08-15T00:00:00Z' }, prevDailyBar: { c: 195 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const { createAlpacaProvider } = await import('../server/providers/alpaca.mjs');
    const quote = (await createAlpacaProvider('test-key', 'test-secret').getQuotes([byId.get('AAPL')])).get('AAPL');
    assert.equal(quote.areaMetric, 'IEX_DOLLAR_VOLUME');
    assert.equal(quote.areaValue, 297_000_000);
    assert.equal(quote.areaAsOf, '2026-08-15T00:00:00.000Z');
  } finally { globalThis.fetch = originalFetch; }
});

test('free EODHD adapter only maps verified underlying index symbols', async () => {
  const { createEodhdProvider } = await import('../server/providers/eodhd.mjs');
  const provider = createEodhdProvider('unused-for-this-test');
  assert.equal(provider.supports(byId.get('SPX')), true);
  assert.equal(provider.supports(byId.get('ASX')), true);
  assert.equal(provider.supports(byId.get('FTSE')), false);
  assert.equal(provider.minimumRefreshMs, 24 * 60 * 60 * 1000);
});

test('free Metals.Dev adapter covers all four cards and is quota limited', async () => {
  const { createMetalsDevProvider } = await import('../server/providers/metals-dev.mjs');
  const provider = createMetalsDevProvider('unused-for-this-test');
  ['XAU', 'XAG', 'XPT', 'XPD'].forEach((id) => assert.equal(provider.supports(byId.get(id)), true));
  assert.equal(provider.minimumRefreshMs, 8 * 60 * 60 * 1000);
});

test('production browser code contains no vendor endpoint or random price generator', async () => {
  const source = await Promise.all(['public/js/adapters.js', 'public/js/widgets.js', 'public/js/dashboard.js'].map((file) => readFile(file, 'utf8')));
  const joined = source.join('\n').toLowerCase();
  ['quote.cnbc.com', 'math.random', 'gensesions', 'seeded random-walk'].forEach((forbidden) => assert.equal(joined.includes(forbidden), false, forbidden));
});
