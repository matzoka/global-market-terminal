import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetalsDevProvider } from '../server/providers/metals-dev.mjs';
import { createEodhdProvider } from '../server/providers/eodhd.mjs';
import { createFrankfurterProvider } from '../server/providers/frankfurter.mjs';

const XAU = { id: 'XAU', kind: 'metal', displaySymbol: 'XAU/USD' };
const SPX = { id: 'SPX', kind: 'index', displaySymbol: 'S&P 500' };
const SX5E = { id: 'SX5E', kind: 'index', displaySymbol: 'EURO STOXX 50' };

test('Metals.dev spot provider no longer supplies daily bars (futures moved to dedicated provider)', () => {
  const p = createMetalsDevProvider('TEST_KEY');
  // Quote routing stays with the spot provider...
  assert.equal(p.supports(XAU), true);
  // ...but daily bars are now owned by YAHOO_FINANCE_METAL_FUTURES.
  assert.equal(p.supportsDailyBars(XAU), false);
});

test('Yahoo metal futures provider supplies XAU daily bars from GC=F', async () => {
  const { createYahooMetalFuturesProvider } = await import('../server/providers/yahoo-metal-futures.mjs');
  const p = createYahooMetalFuturesProvider();
  assert.equal(p.supports(XAU), false); // quote routing stays with spot
  assert.equal(p.supportsDailyBars(XAU), true);
  const bars = await p.getDailyBars(XAU, 60);
  assert.ok(Array.isArray(bars), 'bars is array');
  assert.ok(bars.length >= 2, `expected >=2 daily bars, got ${bars.length}`);
  for (const b of bars) {
    assert.ok(b.time && typeof b.time === 'string', 'has iso date');
    assert.ok(Number.isFinite(b.close) && b.close > 0, 'positive close');
  }
});

test('EODHD getDailyBars still covers SX5E (other indices relocated to YAHOO_FINANCE_INDEX)', async () => {
  const p = createEodhdProvider('TEST_TOKEN');
  // After P2-INDEX Phase A, only SX5E remains under EODHD ownership.
  assert.equal(p.supportsDailyBars(SPX), false);
  assert.equal(p.supportsDailyBars(SX5E), true);
  // Network call may fail in sandbox; just assert shape if it returns.
  try {
    const bars = await p.getDailyBars(SX5E, 60);
    assert.ok(Array.isArray(bars));
  } catch (err) {
    // Allow network failure in CI; only assert supportsDailyBars above.
    assert.ok(err.message.startsWith('provider_') || err.message.includes('fetch'), 'expected provider/network error');
  }
});

test('Frankfurter getDailyBars returns ECB daily FX series', async () => {
  const p = createFrankfurterProvider();
  const bars = await p.getDailyBars({ id: 'USDJPY', providerSymbol: 'USD/JPY' }, 60);
  assert.ok(Array.isArray(bars));
  assert.ok(bars.length >= 5, `expected >=5 daily bars, got ${bars.length}`);
  for (const b of bars) {
    assert.ok(b.time && typeof b.time === 'string');
    assert.ok(Number.isFinite(b.close) && b.close > 0);
  }
});
