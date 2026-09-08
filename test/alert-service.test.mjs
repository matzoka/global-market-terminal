// P2-ALERT Phase A: alert-service evaluation, dedupe, cooldown, recovery, isolation.
// Discord POST is always mocked — no real webhook is contacted.
import assert from 'node:assert/strict';
import test from 'node:test';

function makeRow(id, status, reason, provider) {
  return { id, status, reason, provider };
}

// In-memory KV mock with list() support.
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

// Capture Discord posts without hitting the network.
function installDiscordMock(assertPosts = true) {
  const posts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  return {
    posts,
    restore() { globalThis.fetch = originalFetch; },
  };
}

const { evaluateAlerts } = await import('../server/alert-service.mjs');

test('evaluateAlerts skips cleanly when KV binding is absent', async () => {
  const posts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { posts.push(1); return new Response('{}', { status: 200 }); };
  try {
    const result = await evaluateAlerts([makeRow('SPX', 'PARTIAL_REALTIME', null, 'ALPACA_IEX')], {}, {});
    assert.equal(result.alertsSent, 0);
    assert.equal(result.recovered, 0);
    assert.equal(posts.length, 0, 'no Discord POST when KV is missing');
  } finally { globalThis.fetch = originalFetch; }
});

test('single STALE first failure records only (no Discord notification)', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const rows = [makeRow('SPX', 'STALE', 'provider_request_failed', 'ALPACA_IEX')];
    const result = await evaluateAlerts(rows, { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    assert.equal(result.alertsSent, 0, 'INFO severity => no alert');
    assert.equal(mock.posts.length, 0);
    // KV retains state for consecutive tracking.
    assert.ok(kv._store.has('ALPACA_IEX|provider_request_failed'), 'state stored');
  } finally { mock.restore(); }
});

test('STALE 2 consecutive => WARNING notification', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    // First failure (INFO, recorded).
    await evaluateAlerts([makeRow('SPX', 'STALE', 'provider_request_failed', 'ALPACA_IEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    // Second consecutive failure.
    const result = await evaluateAlerts([makeRow('SPX', 'STALE', 'provider_request_failed', 'ALPACA_IEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    assert.equal(result.alertsSent, 1);
    assert.match(mock.posts[0].body.content, /GMT ALERT — WARNING/);
    assert.match(mock.posts[0].body.content, /Affected:\s*SPX/);
  } finally { mock.restore(); }
});

test('new UNAVAILABLE => CRITICAL immediate notification', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const result = await evaluateAlerts([makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    assert.equal(result.alertsSent, 1);
    assert.match(mock.posts[0].body.content, /GMT ALERT — CRITICAL/);
  } finally { mock.restore(); }
});

test('multiple instruments under one provider are aggregated into a single incident', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const rows = [
      makeRow('SPX', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX'),
      makeRow('NDX', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX'),
      makeRow('DJI', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX'),
    ];
    const result = await evaluateAlerts(rows, { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    assert.equal(result.alertsSent, 1, 'one incident, not three');
    assert.match(mock.posts[0].body.content, /Affected:\s*SPX, NDX, DJI/);
    assert.match(mock.posts[0].body.content, /3\/3/);
  } finally { mock.restore(); }
});

test('duplicate incident within cooldown is not re-notified', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const rows = [makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')];
    const env = { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' };
    const first = await evaluateAlerts(rows, env, {});
    assert.equal(first.alertsSent, 1);
    // Immediate second evaluation (within 30min cooldown) must NOT send again.
    const second = await evaluateAlerts(rows, env, {});
    assert.equal(second.alertsSent, 0);
    assert.equal(mock.posts.length, 1);
  } finally { mock.restore(); }
});

test('WARNING -> CRITICAL escalation notifies even within cooldown', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const env = { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' };
    // Single STALE x2 -> WARNING (1 alert)
    await evaluateAlerts([makeRow('SPX', 'STALE', 'provider_request_failed', 'ALPACA_IEX')], env, {});
    await evaluateAlerts([makeRow('SPX', 'STALE', 'provider_request_failed', 'ALPACA_IEX')], env, {});
    assert.equal(mock.posts.length, 1);
    // Now the same provider escalates to multiple UNAVAILABLE -> CRITICAL.
    const result = await evaluateAlerts([
      makeRow('SPX', 'UNAVAILABLE', 'provider_request_failed', 'ALPACA_IEX'),
      makeRow('AAPL', 'UNAVAILABLE', 'provider_request_failed', 'ALPACA_IEX'),
    ], env, {});
    assert.equal(result.alertsSent, 1, 'escalation re-notifies');
    assert.match(mock.posts[1].body.content, /GMT ALERT — CRITICAL/);
  } finally { mock.restore(); }
});

test('recovery sends exactly one RECOVERED notification', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const env = { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' };
    // Trigger a CRITICAL incident.
    const trigger = await evaluateAlerts([makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')], env, {});
    assert.equal(trigger.alertsSent, 1);
    // Next run: instrument healthy again -> recovery.
    const recover = await evaluateAlerts([makeRow('SX5E', 'PARTIAL_REALTIME', null, 'YAHOO_FINANCE_INDEX')], env, {});
    assert.equal(recover.recovered, 1);
    assert.equal(mock.posts.length, 2);
    assert.match(mock.posts[1].body.content, /GMT RECOVERED/);
    assert.match(mock.posts[1].body.content, /Duration:/);
    // Second healthy run must NOT send another recovery.
    const again = await evaluateAlerts([makeRow('SX5E', 'PARTIAL_REALTIME', null, 'YAHOO_FINANCE_INDEX')], env, {});
    assert.equal(again.recovered, 0);
    assert.equal(mock.posts.length, 2);
  } finally { mock.restore(); }
});

test('recovered incident re-failing opens a fresh incident', async () => {
  const kv = makeKv();
  const mock = installDiscordMock();
  try {
    const env = { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' };
    await evaluateAlerts([makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')], env, {});
    await evaluateAlerts([makeRow('SX5E', 'PARTIAL_REALTIME', null, 'YAHOO_FINANCE_INDEX')], env, {}); // recovered
    // Fail again -> new incident, should re-alert.
    const result = await evaluateAlerts([makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')], env, {});
    assert.equal(result.alertsSent, 1);
    assert.equal(mock.posts.length, 3);
  } finally { mock.restore(); }
});

test('Discord POST failure is absorbed (no throw)', async () => {
  const kv = makeKv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const result = await evaluateAlerts([makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, {});
    assert.equal(result.alertsSent, 0, 'delivery failed, counted as not sent');
    // Should not throw.
  } finally { globalThis.fetch = originalFetch; }
});

test('webhook URL is never written to logs', async () => {
  const kv = makeKv();
  const originalFetch = globalThis.fetch;
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async () => new Response('', { status: 500 }); // force delivery_failed
  try {
    await evaluateAlerts([makeRow('SX5E', 'UNAVAILABLE', 'provider_request_failed', 'YAHOO_FINANCE_INDEX')],
      { GMT_ALERT_STATE: kv, DISCORD_WEBHOOK_URL: 'https://discord.example/SECRET/webhook' }, {});
    const joined = logs.join(' ');
    assert.ok(!joined.includes('SECRET'), 'secret must not appear in logs');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
