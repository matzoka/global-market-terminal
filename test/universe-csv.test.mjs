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
G.changePercent = (item) => {
  if (item.id === 'ACWI') return 1.23;
  if (item.id === 'USDJPY') return -0.45;
  if (item.id === 'BTCJPY') return 2.34;
  return null;
};
G.changeProvenance = (item) => {
  if (item.researchGroup === 'fx') return { changeBasis: 'FRANKFURTER_ECB_PREV_BUSINESS_DAY' };
  if (item.researchGroup === 'crypto') return { changeBasis: 'COINBASE_SPOT_VS_YAHOO_PREV_UTC_DAY' };
  return null;
};

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

function installDocument() {
  globalThis.document = {
    createElement: createDomNode,
    getElementById() { return null; },
  };
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

test('universe panel shows change basis once on FX/crypto headers, not on each row', () => {
  installDocument();
  G.store.BTCJPY = {
    id: 'BTCJPY', name: 'ビットコイン／円', displaySymbol: 'BTC/JPY', researchGroup: 'crypto', decimals: 0,
    quote: { price: 12600000, provider: 'COINBASE_PUBLIC', deliveryLabel: 'COINBASE PUBLIC SPOT', status: 'DELAYED', asOf: '2026-09-21T00:00:00.000Z' },
  };
  try {
    const root = createDomNode('div');
    G.widgets.initUniverse(root);
    G.widgets.updateUniverse();

    const globalTitle = byClass(root, 'universe-global')[0] && byClass(byClass(root, 'universe-global')[0], 'universe-title')[0];
    const fxTitle = byClass(root, 'universe-fx')[0] && byClass(byClass(root, 'universe-fx')[0], 'universe-title')[0];
    const cryptoTitle = byClass(root, 'universe-crypto')[0] && byClass(byClass(root, 'universe-crypto')[0], 'universe-title')[0];
    assert.ok(globalTitle && fxTitle && cryptoTitle, 'each research group must render a header');
    assert.match(globalTitle.textContent, /世界株・オルカン参考/);
    assert.doesNotMatch(globalTitle.textContent, /前営業日比|前UTC日比/);
    assert.match(fxTitle.textContent, /為替（主要通貨ペア）/);
    assert.match(fxTitle.textContent, /前営業日比/);
    assert.equal(byClass(fxTitle, 'universe-basis').length, 1);
    assert.equal(byClass(fxTitle, 'universe-basis')[0].textContent, '前営業日比');
    assert.match(cryptoTitle.textContent, /暗号資産（参考）/);
    assert.match(cryptoTitle.textContent, /前UTC日比/);
    assert.equal(byClass(cryptoTitle, 'universe-basis').length, 1);
    assert.equal(byClass(cryptoTitle, 'universe-basis')[0].textContent, '前UTC日比');

    const rows = byClass(root, 'universe-row');
    assert.equal(rows.length, 15);
    for (const row of rows) {
      assert.doesNotMatch(row.textContent, /前営業日比|前UTC日比/);
    }

    const changeBySymbol = Object.fromEntries(
      rows.map((row) => [byClass(row, 'u-symbol')[0].textContent, byClass(row, 'u-change')[0].textContent]),
    );
    assert.equal(changeBySymbol.ACWI, '+1.23%');
    assert.equal(changeBySymbol.USDJPY, '-0.45%');
    assert.equal(changeBySymbol['BTC/JPY'], '+2.34%');
    assert.equal(byClass(rows.find((row) => byClass(row, 'u-symbol')[0].textContent === 'USDJPY'), 'u-spark').length, 1);

    let captured = null;
    G.csv.download = (filename, text) => { captured = { filename, text }; };
    assert.equal(G.widgets.exportUniverse(), true);
    const btcRow = captured.text.split('\r\n').find((line) => line.includes('BTCJPY'));
    assert.ok(btcRow.includes('前UTC日比'), 'CSV provenance for crypto must remain');
  } finally {
    delete G.store.BTCJPY;
  }
});
