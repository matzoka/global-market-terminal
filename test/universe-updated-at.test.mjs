// Universe panel: one last-updated time in the panel header, computed from the
// newest quote fetch among displayed instruments (GMT-UX-04 dynamic universe).
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
stamp.textContent = '更新 --';

globalThis.document = {
  createElement: createDomNode,
  getElementById(id) { return id === 'universe-updated' ? stamp : null; },
};

function quote(partial) { return { price: 1, status: 'EOD', ...partial }; }

G.bars = {};
G.store = {};
G.meta = {};
G.get = (id) => G.store[id] || null;
G.changePercent = (item) => (item && item.id === 'ACWI' ? 1.23 : item && item.id === 'USDJPY' ? -0.45 : null);
G.changeProvenance = (item) => (item && item.researchGroup === 'fx' ? { changeBasis: 'FRANKFURTER_ECB_PREV_BUSINESS_DAY' } : null);
G.watchlist = { ids: () => [], has: () => false, toggle: () => false, onChange: () => {} };
G.freshness = {
  label: (q) => ({ FRESH: '正常', STALE: '要更新', UNKNOWN: '未評価', UNAVAILABLE: '未取得' }[q && q.freshness] || '未評価'),
  ageText: () => 'たった今',
  sourceText: (q) => (q && q.provider) || '未取得',
};

await import('../public/js/csv.js');
await import('../public/js/widgets.js');

test('formatUpdatedAt renders a compact UTC clock or a placeholder', () => {
  assert.equal(G.widgets.formatUpdatedAt('2026-09-21T20:01:32.123Z'), '更新 2026-09-21 20:01 UTC');
  assert.equal(G.widgets.formatUpdatedAt(null), '更新 --');
  assert.equal(G.widgets.formatUpdatedAt('not-a-date'), '更新 --');
});

test('latestUniverseTimestamp uses the newest fetchedAt among displayed instruments', () => {
  G.store = {
    ACWI: { id: 'ACWI', quote: quote({ fetchedAt: '2026-09-21T20:01:00.000Z' }) },
    USDJPY: { id: 'USDJPY', researchGroup: 'fx', quote: quote({ fetchedAt: '2026-09-21T16:00:00.000Z' }) },
    BTCJPY: { id: 'BTCJPY', researchGroup: 'crypto', quote: quote({ fetchedAt: '2026-09-21T19:55:00.000Z' }) },
  };
  G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };
  assert.equal(G.widgets.latestUniverseTimestamp(), '2026-09-21T20:01:00.000Z');
});

test('latestUniverseTimestamp falls back to generatedAt when quotes have no fetch time', () => {
  G.store = { ACWI: { id: 'ACWI', quote: quote({ price: 123 }) } };
  G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };
  assert.equal(G.widgets.latestUniverseTimestamp(), '2026-09-21T20:05:00.000Z');
});

test('universe header shows one last-updated time; rows keep prices without repeating it', () => {
  G.store = {
    ACWI: { id: 'ACWI', displaySymbol: 'ACWI', researchGroup: 'global', decimals: 2, quote: quote({ price: 123.45, status: 'PARTIAL_REALTIME', fetchedAt: '2026-09-21T20:01:00.000Z' }) },
    USDJPY: { id: 'USDJPY', displaySymbol: 'USDJPY', researchGroup: 'fx', decimals: 3, quote: quote({ price: 147.123, fetchedAt: '2026-09-21T16:00:00.000Z' }) },
    BTCJPY: { id: 'BTCJPY', displaySymbol: 'BTC/JPY', researchGroup: 'crypto', decimals: 0, quote: quote({ price: 12600000, fetchedAt: '2026-09-21T19:55:00.000Z' }) },
  };
  G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };

  const root = createDomNode('div');
  G.widgets.initUniverse(root);
  G.widgets.updateUniverse();

  assert.equal(stamp.textContent, '更新 2026-09-21 20:01 UTC');
  assert.match(stamp.title, /2026-09-21T20:01:00\.000Z/);

  const rows = root.querySelectorAll('.universe-row');
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.doesNotMatch(row.textContent, /更新 2026-09-21 20:01 UTC/);
    assert.doesNotMatch(row.textContent, /前営業日比|前UTC日比/);
  }

  const titles = root.querySelectorAll('.universe-title');
  assert.equal(titles.length, 3);
  assert.doesNotMatch(titles[0].textContent, /前営業日比|前UTC日比/);
  assert.equal(titles[1].querySelectorAll('.universe-basis')[0].textContent, '前営業日比');
  assert.equal(titles[2].querySelectorAll('.universe-basis')[0].textContent, '前UTC日比');

  const changeBySymbol = Object.fromEntries(rows.map((row) => [row.querySelectorAll('.u-symbol')[0].textContent, { price: row.querySelectorAll('.u-price')[0].textContent, change: row.querySelectorAll('.u-change')[0].textContent }]));
  assert.equal(changeBySymbol.ACWI.price, '123.45');
  assert.equal(changeBySymbol.ACWI.change, '+1.23%');
  assert.equal(changeBySymbol.USDJPY.price, '147.123');
  assert.equal(changeBySymbol.USDJPY.change, '-0.45%');
  assert.equal(changeBySymbol['BTC/JPY'].price, '12,600,000');
});
