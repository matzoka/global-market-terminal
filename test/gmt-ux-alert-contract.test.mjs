// GMT-UX-01 / GMT-UX-09: alert delivery, severity worst-value, and channel separation.
import assert from 'node:assert/strict';
import test from 'node:test';

function makeRow(id, status, reason, provider) {
  return { id, status, reason, provider };
}

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key, opts) {
      const v = store.get(key);
      if (!v) return null;
      return opts?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })) }; },
    _store: store,
  };
}

function discordMock({ ok = true } = {}) {
  const posts = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!ok) throw new Error('network down');
    posts.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  return { posts, restore() { globalThis.fetch = original; } };
}

const { evaluateAlerts, ALERT_CHANNELS } = await import('../server/alert-service.mjs');

test('mixed STALE+UNAVAILABLE incident uses the worst status/severity, not the first row', async () => {
  const kv = makeKv();
  const mock = discordMock();
  try {
    const rows = [
      makeRow('SPX', 'STALE', 'provider_request_failed', 'ALPACA_IEX'),
      makeRow('AAPL', 'UNAVAILABLE', 'provider_request_failed', 'ALPACA_IEX'),
    ];
    const result = await evaluateAlerts(rows, { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    assert.equal(result.alertsSent, 1);
    const text = mock.posts[0].body.content;
    // Worst status is UNAVAILABLE regardless of array order.
    assert.match(text, /データ取得不能/);
    // UNAVAILABLE (2 affected) is WARNING, never INFO.
    assert.match(text, /データ取得障害（警告）/);
  } finally { mock.restore(); }
});

test('a broad STALE outage stays WARNING (STALE is never more severe than UNAVAILABLE)', async () => {
  const kv = makeKv();
  const mock = discordMock();
  try {
    const env = { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' };
    const rows = ['SPX', 'AAPL', 'NVDA', 'MSFT', 'GOOGL'].map((id) => makeRow(id, 'STALE', 'provider_request_failed', 'ALPACA_IEX'));
    await evaluateAlerts(rows, env, {}); // INFO: record only
    const result = await evaluateAlerts(rows, env, {}); // consecutive -> WARNING
    assert.equal(result.alertsSent, 1);
    const text = mock.posts[0].body.content;
    assert.match(text, /データ取得障害（警告）/);
    assert.ok(!/データ取得障害（重大）/.test(text), 'STALE must not be reported as CRITICAL');
  } finally { mock.restore(); }
});

test('a failed delivery does not start the 12h cooldown and schedules a short retry', async () => {
  const kv = makeKv();
  const mock = discordMock({ ok: false });
  try {
    const result = await evaluateAlerts(
      [makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {},
    );
    assert.equal(result.alertsSent, 0, 'delivery failed');
    const stored = JSON.parse(kv._store.get('YAHOO_FINANCE_INDEX|provider_request_failed'));
    assert.equal(stored.lastAlertAt, null, 'a failed send must not look "sent"');
    assert.ok(!stored.alerted, 'not marked alerted');
    assert.equal(stored.deliveryFailures, 1);
    const retryDelay = Date.parse(stored.nextAttemptAt) - Date.now();
    assert.ok(retryDelay > 0 && retryDelay <= 30 * 60 * 1000, 'retry is scheduled within 30min, not 12h');
  } finally { mock.restore(); }
});

test('the system-alerts channel id is recorded and surfaced in the message', async () => {
  const kv = makeKv();
  const mock = discordMock();
  try {
    await evaluateAlerts(
      [makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {},
    );
    const stored = JSON.parse(kv._store.get('YAHOO_FINANCE_INDEX|provider_request_failed'));
    assert.equal(stored.channel, 'system-alerts');
    assert.match(mock.posts[0].body.content, /#system-alerts/);
    // The other channels exist as independently addressable destinations.
    assert.equal(ALERT_CHANNELS.APPROVALS.id, 'approvals');
    assert.equal(ALERT_CHANNELS.MARKET_SIGNALS.id, 'market-signals');
    assert.notEqual(ALERT_CHANNELS.SYSTEM_ALERTS.webhookEnv, ALERT_CHANNELS.MARKET_SIGNALS.webhookEnv);
  } finally { mock.restore(); }
});
