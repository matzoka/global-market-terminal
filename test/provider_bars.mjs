import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetalsDevProvider } from '../server/providers/metals-dev.mjs';
import { createEodhdProvider } from '../server/providers/eodhd.mjs';
import { createFrankfurterProvider } from '../server/providers/frankfurter.mjs';

const XAU = { id: 'XAU', kind: 'metal', displaySymbol: 'XAU/USD' };
const SPX = { id: 'SPX', kind: 'index', displaySymbol: 'S&P 500' };

test('Metals.dev getDailyBars returns daily XAU series from Yahoo Finance (keyless)', async () => {
  const p = createMetalsDevProvider('TEST_KEY');
  const bars = await p.getDailyBars(XAU, 60);
  assert.ok(Array.isArray(bars), 'bars is array');
  assert.ok(bars.length >= 10, `expected >=10 daily bars, got ${bars.length}`);
  for (const b of bars) {
    assert.ok(b.time && typeof b.time === 'string', 'has iso date');
    assert.ok(Number.isFinite(b.close) && b.close > 0, 'positive close');
  }
});

test('EODHD getDailyBars covers index instruments', async () => {
  const p = createEodhdProvider('TEST_TOKEN');
  assert.equal(p.supportsDailyBars(SPX), true);
  // Network call may fail in sandbox; just assert shape if it returns.
  try {
    const bars = await p.getDailyBars(SPX, 60);
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
