import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis.window || {};
const G = (globalThis.window.GMT = globalThis.window.GMT || {});
await import('../public/js/csv.js');

G.bars = {};
G.store = {
  ACWI: {
    id: 'ACWI', name: 'MSCI ACWI ETF（オルカン参考）', displaySymbol: 'ACWI', decimals: 2,
    quote: { price: 123.456, provider: 'ALPACA_IEX', deliveryLabel: 'IEX DAILY BARS — SINGLE U.S. EXCHANGE', status: 'PARTIAL_REALTIME', asOf: '2026-09-21T20:00:00.000Z', fetchedAt: '2026-09-21T20:01:00.000Z' },
  },
  USDJPY: {
    id: 'USDJPY', name: '米ドル／円', researchGroup: 'fx', decimals: 3,
    quote: { price: 147.123, provider: 'FRANKFURTER_ECB', deliveryLabel: 'FRANKFURTER — ECB DAILY REFERENCE', status: 'EOD', asOf: '2026-09-21T00:00:00.000Z' },
  },
};
G.get = (id) => G.store[id] || null;
G.changePercent = (item) => (item.id === 'ACWI' ? 1.23 : item.id === 'USDJPY' ? -0.45 : null);
G.changeProvenance = (item) => (item.researchGroup === 'fx' ? { changeBasis: 'FRANKFURTER_ECB_PREV_BUSINESS_DAY' } : null);

await import('../public/js/widgets.js');

test('exportUniverse writes the displayed rows in panel order', () => {
  let captured = null;
  G.csv.download = (filename, text) => { captured = { filename, text }; };
  const result = G.widgets.exportUniverse();
  assert.equal(result, true);
  assert.ok(captured, 'download must be called');
  assert.match(captured.filename, /^gmt-universe-\d{14}\.csv$/);
  assert.equal(captured.text.charCodeAt(0), 0xfeff);
  const lines = captured.text.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], '区分,銘柄コード,表示記号,名称,価格,前日比(%),変化基準,出所,配信区分,状態,基準時刻,取得時刻');
  assert.equal(lines.length, 16, 'header + 15 displayed universe rows');
  assert.ok(lines[1].startsWith('世界株・オルカン参考,ACWI,ACWI,MSCI ACWI ETF'));
  assert.ok(lines[1].includes('ALPACA_IEX'));
  assert.ok(lines[1].includes('IEX一部'));
  const fxRow = lines.find((line) => line.includes('USDJPY'));
  assert.ok(fxRow.startsWith('為替（主要通貨ペア）,USDJPY,USDJPY,米ドル／円,147.123,-0.45,前営業日比'));
  assert.ok(fxRow.includes('終値'));
  const missing = lines.find((line) => line.startsWith('暗号資産（参考）,BTCJPY'));
  assert.ok(missing.endsWith(',未取得,,'));
});
