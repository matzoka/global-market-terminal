import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis.window || {};
await import('../public/js/csv.js');
const csv = globalThis.window.GMT.csv;

test('csv module exposes helpers', () => {
  assert.equal(typeof csv.toCsv, 'function');
  assert.equal(typeof csv.filenameStamp, 'function');
  assert.equal(typeof csv.download, 'function');
});

test('toCsv emits a BOM, CRLF rows, and a header line', () => {
  const text = csv.toCsv(
    [{ key: 'symbol', label: '銘柄コード' }, { key: 'price', label: '価格' }],
    [{ symbol: 'ACWI', price: 123.45 }, { symbol: 'USDJPY', price: 147.123 }],
  );
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.ok(text.endsWith('\r\n'));
  assert.deepEqual(text.slice(1).trimEnd().split('\r\n'), [
    '銘柄コード,価格',
    'ACWI,123.45',
    'USDJPY,147.123',
  ]);
});

test('toCsv quotes fields containing separators, quotes and newlines', () => {
  const text = csv.toCsv(
    [{ key: 'name', label: '名称' }, { key: 'note', label: 'メモ' }],
    [{ name: '日経,225', note: 'line1\nline2 "quoted"' }],
  );
  assert.ok(text.includes('"日経,225"'));
  assert.ok(text.includes('"line1\nline2 ""quoted"""'));
});

test('toCsv renders missing values as empty fields', () => {
  const text = csv.toCsv(
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
    [{ a: null, b: undefined, c: 0 }],
  );
  assert.equal(text.slice(1), 'A,B,C\r\n,,0\r\n');
});

test('filenameStamp uses a UTC timestamp without separators', () => {
  assert.equal(csv.filenameStamp(new Date('2026-09-22T03:04:05.678Z')), '20260922030405');
});
