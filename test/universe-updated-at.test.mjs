import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis.window || {};
const G = (globalThis.window.GMT = globalThis.window.GMT || {});
await import('../public/js/csv.js');

G.bars = {};
G.store = {};
G.meta = {};
G.get = (id) => G.store[id] || null;
G.changePercent = (item) => (item && item.id === 'ACWI' ? 1.23 : item && item.id === 'USDJPY' ? -0.45 : null);
G.changeProvenance = (item) => (item && item.researchGroup === 'fx' ? { changeBasis: 'FRANKFURTER_ECB_PREV_BUSINESS_DAY' } : null);

function createDomNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    id: '',
    childNodes: [],
    attributes: {},
    style: {},
    tabIndex: 0,
    width: 0,
    height: 0,
    title: '',
    classList: {
      add(...names) {
        const set = new Set(String(node.className).split(/\s+/).filter(Boolean));
        names.forEach((name) => set.add(name));
        node.className = [...set].join(' ');
      },
      toggle(name, force) {
        const set = new Set(String(node.className).split(/\s+/).filter(Boolean));
        const on = force == null ? !set.has(name) : !!force;
        if (on) set.add(name); else set.delete(name);
        node.className = [...set].join(' ');
        return on;
      },
      contains(name) {
        return String(node.className).split(/\s+/).includes(name);
      },
    },
    setAttribute(key, value) { node.attributes[key] = String(value); },
    getAttribute(key) { return node.attributes[key]; },
    addEventListener() {},
    getContext() {
      return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    },
    appendChild(child) {
      node.childNodes.push(child);
      child.parentNode = node;
      return child;
    },
    append(...children) { children.forEach((child) => node.appendChild(child)); },
    get textContent() {
      if (Object.prototype.hasOwnProperty.call(node, '_text')) return node._text;
      return node.childNodes.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      node._text = value == null ? '' : String(value);
      node.childNodes = [];
    },
  };
  return node;
}

function descendants(node, acc = []) {
  for (const child of node.childNodes || []) {
    acc.push(child);
    descendants(child, acc);
  }
  return acc;
}

function byClass(root, name) {
  return descendants(root).filter((node) => node.classList && node.classList.contains(name));
}

const stamp = createDomNode('span');
stamp.id = 'universe-updated';
stamp.textContent = '更新 --';
stamp.title = '注目市場データの最終更新時刻';

globalThis.document = {
  createElement: createDomNode,
  getElementById(id) { return id === 'universe-updated' ? stamp : id === 'btn-universe-csv' ? null : null; },
};

await import('../public/js/widgets.js');

function quote(partial) {
  return { price: 1, status: 'EOD', ...partial };
}

test('formatUpdatedAt renders a compact UTC clock or a placeholder', () => {
  assert.equal(G.widgets.formatUpdatedAt('2026-09-21T20:01:32.123Z'), '更新 2026-09-21 20:01 UTC');
  assert.equal(G.widgets.formatUpdatedAt(null), '更新 --');
  assert.equal(G.widgets.formatUpdatedAt('not-a-date'), '更新 --');
});

test('latestUniverseTimestamp uses the newest fetchedAt among displayed rows', () => {
  G.store = {
    ACWI: { id: 'ACWI', quote: quote({ fetchedAt: '2026-09-21T20:01:00.000Z' }) },
    USDJPY: { id: 'USDJPY', researchGroup: 'fx', quote: quote({ fetchedAt: '2026-09-21T16:00:00.000Z' }) },
    BTCJPY: { id: 'BTCJPY', researchGroup: 'crypto', quote: quote({ fetchedAt: '2026-09-21T19:55:00.000Z' }) },
  };
  G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };
  assert.equal(G.widgets.latestUniverseTimestamp(), '2026-09-21T20:01:00.000Z');
});

test('latestUniverseTimestamp falls back to generatedAt when quotes have no fetch time', () => {
  G.store = {
    ACWI: { id: 'ACWI', quote: quote({ price: 123 }) },
  };
  G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };
  assert.equal(G.widgets.latestUniverseTimestamp(), '2026-09-21T20:05:00.000Z');
});

test('latestUniverseTimestamp ignores instruments that are not in the universe panel', () => {
  G.store = {
    XAU: { id: 'XAU', quote: quote({ fetchedAt: '2026-09-21T21:00:00.000Z' }) },
    ACWI: { id: 'ACWI', quote: quote({ fetchedAt: '2026-09-21T18:00:00.000Z' }) },
  };
  G.meta = {};
  assert.equal(G.widgets.latestUniverseTimestamp(), '2026-09-21T18:00:00.000Z');
});

test('universe header shows one last-updated time and rows keep prices without repeating it', () => {
  G.store = {
    ACWI: {
      id: 'ACWI', displaySymbol: 'ACWI', decimals: 2,
      quote: quote({ price: 123.45, status: 'PARTIAL_REALTIME', fetchedAt: '2026-09-21T20:01:00.000Z' }),
    },
    USDJPY: {
      id: 'USDJPY', displaySymbol: 'USDJPY', researchGroup: 'fx', decimals: 3,
      quote: quote({ price: 147.123, fetchedAt: '2026-09-21T16:00:00.000Z' }),
    },
  };
  G.meta = { generatedAt: '2026-09-21T20:05:00.000Z' };

  const root = createDomNode('div');
  G.widgets.initUniverse(root);
  G.widgets.updateUniverse();

  assert.equal(stamp.textContent, '更新 2026-09-21 20:01 UTC');
  assert.match(stamp.title, /2026-09-21T20:01:00\.000Z/);

  const rows = byClass(root, 'universe-row');
  assert.equal(rows.length, 15);
  for (const row of rows) {
    assert.doesNotMatch(row.textContent, /更新 2026-09-21 20:01 UTC/);
  }

  const changeBySymbol = Object.fromEntries(
    rows.map((row) => [byClass(row, 'u-symbol')[0].textContent, {
      price: byClass(row, 'u-price')[0].textContent,
      change: byClass(row, 'u-change')[0].textContent,
    }]),
  );
  assert.equal(changeBySymbol.ACWI.price, '123.45');
  assert.equal(changeBySymbol.ACWI.change, '+1.23%');
  assert.equal(changeBySymbol.USDJPY.price, '147.123');
  assert.equal(changeBySymbol.USDJPY.change, '-0.45% · 前営業日比');
  assert.equal(changeBySymbol.BTCJPY.price, '—');
});
