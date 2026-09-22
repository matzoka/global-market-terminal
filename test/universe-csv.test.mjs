// Universe panel: CSV export of displayed rows + change-basis labels shown once
// on FX/crypto group headers. Updated for the GMT-UX-04 dynamic 43-instrument
// universe (the panel is no longer a fixed 15-instrument list).
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis.window || {};
const G = (globalThis.window.GMT = globalThis.window.GMT || {});

function matches(node, selector) {
  return String(selector).split(',').map((s) => s.trim()).some((sel) => {
    if (sel.startsWith('.')) return node.classList && node.classList.contains(sel.slice(1));
    return node.tagName === sel.toUpperCase();
  });
}

function createDomNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    id: '',
    childNodes: [],
    attributes: {},
    dataset: {},
    style: {},
    value: '',
    checked: false,
    selected: false,
    tabIndex: 0,
    width: 0,
    height: 0,
    title: '',
    classList: {
      add(...names) { const set = new Set(String(node.className).split(/\s+/).filter(Boolean)); names.forEach((n) => set.add(n)); node.className = [...set].join(' '); },
      remove(...names) { const set = new Set(String(node.className).split(/\s+/).filter(Boolean)); names.forEach((n) => set.delete(n)); node.className = [...set].join(' '); },
      toggle(name, force) { const set = new Set(String(node.className).split(/\s+/).filter(Boolean)); const on = force == null ? !set.has(name) : !!force; if (on) set.add(name); else set.delete(name); node.className = [...set].join(' '); return on; },
      contains(name) { return String(node.className).split(/\s+/).includes(name); },
    },
    setAttribute(key, value) { node.attributes[key] = String(value); },
    getAttribute(key) { return node.attributes[key]; },
    addEventListener() {},
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; },
    appendChild(child) { node.childNodes.push(child); child.parentNode = node; return child; },
    append(...children) { children.forEach((child) => node.appendChild(child)); },
    replaceChildren(...children) { node.childNodes = []; children.forEach((child) => node.appendChild(child)); },
    closest(selector) { let current = node; while (current) { if (matches(current, selector)) return current; current = current.parentNode; } return null; },
    querySelectorAll(selector) {
      const found = [];
      (function walk(n) { for (const child of n.childNodes || []) { if (matches(child, selector)) found.push(child); walk(child); } })(node);
      return found;
    },
    get textContent() {
      if (Object.prototype.hasOwnProperty.call(node, '_text')) return node._text;
      return node.childNodes.map((child) => child.textContent).join('');
    },
    set textContent(value) { node._text = value == null ? '' : String(value); node.childNodes = []; },
  };
  return node;
}

const stamp = createDomNode('span');
stamp.id = 'universe-updated';

globalThis.document = {
  createElement: createDomNode,
  getElementById(id) { return id === 'universe-updated' ? stamp : null; },
};

function quote(partial) { return { price: 1, status: 'EOD', provider: 'TEST', ...partial }; }

G.bars = {};
G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };
G.store = {
  ACWI: {
    id: 'ACWI', name: 'MSCI ACWI ETF（オルカン参考）', displaySymbol: 'ACWI', researchGroup: 'global', decimals: 2,
    quote: quote({ price: 123.456, provider: 'ALPACA_IEX', deliveryLabel: 'IEX DAILY BARS — SINGLE U.S. EXCHANGE', status: 'PARTIAL_REALTIME', asOf: '2026-09-21T20:00:00.000Z', fetchedAt: '2026-09-21T20:01:00.000Z' }),
  },
  USDJPY: {
    id: 'USDJPY', name: '米ドル／円', researchGroup: 'fx', decimals: 3,
    quote: quote({ price: 147.123, provider: 'FRANKFURTER_ECB', deliveryLabel: 'FRANKFURTER — ECB DAILY REFERENCE', asOf: '2026-09-21T00:00:00.000Z' }),
  },
  BTCJPY: {
    id: 'BTCJPY', name: 'ビットコイン／円', displaySymbol: 'BTC/JPY', researchGroup: 'crypto', decimals: 0,
    quote: quote({ price: 12600000, provider: 'COINBASE_PUBLIC', deliveryLabel: 'COINBASE PUBLIC SPOT', status: 'DELAYED', asOf: '2026-09-21T00:00:00.000Z' }),
  },
  NVDA: { id: 'NVDA', name: 'NVIDIA', kind: 'equity', decimals: 2, quote: quote({ price: 227.3, provider: 'ALPACA_IEX' }) },
  XAU: { id: 'XAU', name: 'GOLD', kind: 'metal', displaySymbol: 'XAU/USD', decimals: 2, quote: quote({ price: 2412.3, provider: 'METALS_DEV_SPOT' }) },
};
G.get = (id) => G.store[id] || null;
G.changePercent = (item) => ({ ACWI: 1.23, USDJPY: -0.45, BTCJPY: 2.34, NVDA: 2.11, XAU: 0.21 })[item && item.id] ?? null;
G.changeProvenance = (item) => {
  if (item.researchGroup === 'fx') return { changeBasis: 'FRANKFURTER_ECB_PREV_BUSINESS_DAY' };
  if (item.researchGroup === 'crypto') return { changeBasis: 'COINBASE_SPOT_VS_YAHOO_PREV_UTC_DAY' };
  return null;
};
G.watchlist = { ids: () => [], has: () => false, toggle: () => false, onChange: () => {} };
G.freshness = {
  label: (q) => ({ FRESH: '正常', STALE: '要更新', UNKNOWN: '未評価', UNAVAILABLE: '未取得' }[q && q.freshness] || '未評価'),
  ageText: () => 'たった今',
  sourceText: (q) => (q && q.provider) || '未取得',
};

await import('../public/js/csv.js');
await import('../public/js/widgets.js');

test('exportUniverse writes every displayed universe row with its group and change basis', () => {
  let captured = null;
  G.csv.download = (filename, text) => { captured = { filename, text }; };
  const result = G.widgets.exportUniverse();
  assert.equal(result, true);
  assert.ok(captured, 'download must be called');
  assert.match(captured.filename, /^gmt-universe-\d{14}\.csv$/);
  assert.equal(captured.text.charCodeAt(0), 0xfeff);
  const lines = captured.text.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], '区分,銘柄コード,表示記号,名称,価格,前日比(%),変化基準,出所,配信区分,状態,基準時刻,取得時刻');
  assert.equal(lines.length, 6, 'header + all 5 displayed universe rows');
  const acwi = lines.find((line) => line.includes('ACWI'));
  assert.ok(acwi.startsWith('世界株・オルカン参考,ACWI,ACWI,MSCI ACWI ETF'));
  assert.ok(acwi.includes('ALPACA_IEX'));
  assert.ok(acwi.includes('IEX一部'));
  const fxRow = lines.find((line) => line.includes('USDJPY'));
  assert.ok(fxRow.startsWith('為替（主要通貨ペア）,USDJPY,USDJPY,米ドル／円,147.123,-0.45,前営業日比'));
  const cryptoRow = lines.find((line) => line.includes('BTCJPY'));
  assert.ok(cryptoRow.startsWith('暗号資産（参考）,BTCJPY,BTC/JPY'));
  assert.ok(cryptoRow.includes('前UTC日比'), 'CSV provenance for crypto must remain');
  assert.ok(lines.find((line) => line.includes('NVDA')).startsWith('米国株（セクター）,NVDA'));
  assert.ok(lines.find((line) => line.includes('XAU')).startsWith('金属（参考）,XAU'));
});

test('universe panel shows change basis once on FX/crypto headers, not on each row', () => {
  const root = createDomNode('div');
  G.widgets.initUniverse(root);
  G.widgets.updateUniverse();

  const globalTitle = root.querySelectorAll('.universe-global')[0].querySelectorAll('.universe-title')[0];
  const fxTitle = root.querySelectorAll('.universe-fx')[0].querySelectorAll('.universe-title')[0];
  const cryptoTitle = root.querySelectorAll('.universe-crypto')[0].querySelectorAll('.universe-title')[0];
  assert.ok(globalTitle && fxTitle && cryptoTitle, 'each research group must render a header');
  assert.match(globalTitle.textContent, /世界株・オルカン参考/);
  assert.doesNotMatch(globalTitle.textContent, /前営業日比|前UTC日比/);
  assert.match(fxTitle.textContent, /為替（主要通貨ペア）/);
  assert.equal(fxTitle.querySelectorAll('.universe-basis')[0].textContent, '前営業日比');
  assert.match(cryptoTitle.textContent, /暗号資産（参考）/);
  assert.equal(cryptoTitle.querySelectorAll('.universe-basis')[0].textContent, '前UTC日比');
  assert.ok(root.querySelectorAll('.universe-equity').length === 1, 'equity group renders');
  assert.ok(root.querySelectorAll('.universe-metal').length === 1, 'metal group renders');

  const rows = root.querySelectorAll('.universe-row');
  assert.equal(rows.length, 5, 'all displayed instruments render');
  for (const row of rows) assert.doesNotMatch(row.textContent, /前営業日比|前UTC日比/);

  const changeBySymbol = Object.fromEntries(rows.map((row) => [row.querySelectorAll('.u-symbol')[0].textContent, row.querySelectorAll('.u-change')[0].textContent]));
  assert.equal(changeBySymbol.ACWI, '+1.23%');
  assert.equal(changeBySymbol.USDJPY, '-0.45%');
  assert.equal(changeBySymbol['BTC/JPY'], '+2.34%');
  assert.equal(rows.find((row) => row.querySelectorAll('.u-symbol')[0].textContent === 'USDJPY').querySelectorAll('.u-spark').length, 1);
});
