/* Global Market Terminal — production data client. No synthetic prices or browser-to-vendor calls. */
window.GMT = window.GMT || {};

(function (G) {
  'use strict';
  G.store = Object.create(null);
  G.bars = Object.create(null);
  var updateListeners = [], barsListeners = [], pollTimer = null, inFlight = false, lastDashboard = null;
  G.onUpdate = function (fn) { updateListeners.push(fn); };
  G.onBars = function (fn) { barsListeners.push(fn); };
  G.get = function (id) { return G.store[id] || null; };
  G.changePercent = function (item) {
    var q = item && item.quote;
    return q && Number.isFinite(q.price) && Number.isFinite(q.previousClose) && q.previousClose > 0 ? (q.price / q.previousClose - 1) * 100 : null;
  };
  function notify() { updateListeners.forEach(function (fn) { try { fn(lastDashboard); } catch (_) {} }); }
  function notifyBars(id) { barsListeners.forEach(function (fn) { try { fn(id, G.bars[id]); } catch (_) {} }); }
  function actualHistory(item, previous) {
    var q = item.quote;
    if (!q || !Number.isFinite(q.price) || ['PARTIAL_REALTIME', 'REALTIME', 'DELAYED', 'EOD', 'UNVERIFIED', 'STALE'].indexOf(q.status) < 0) return previous || [];
    // EODHD returns a verified close series with the same response as its
    // latest index price. Prefer it over a browser-session-only sparkline.
    if (Array.isArray(q.history) && q.history.length >= 2 && q.history.every(Number.isFinite)) return q.history.slice(-90);
    var history = previous || [];
    if (!history.length || history[history.length - 1] !== q.price) history = history.concat([q.price]).slice(-90);
    return history;
  }
  function applyDashboard(data) {
    lastDashboard = data;
    (data.instruments || []).forEach(function (item) { var old = G.store[item.id]; item.history = actualHistory(item, old && old.history); G.store[item.id] = item; });
    G.meta = { generatedAt: data.generatedAt, provider: data.provider, quoteCacheSeconds: data.quoteCacheSeconds };
    notify();
  }
  async function request(path) {
    var response = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || ('http_' + response.status));
    return body;
  }
  G.api = {
    async refresh(force) {
      if (inFlight) return lastDashboard;
      inFlight = true;
      try { var data = await request('/api/v1/dashboard' + (force ? '?refresh=1' : '')); applyDashboard(data); return data; }
      finally { inFlight = false; }
    },
    async loadBars(id, limit) { var size = Math.min(250, Math.max(2, Number(limit) || 60)); var data = await request('/api/v1/instruments/' + encodeURIComponent(id) + '/bars?limit=' + size); G.bars[id] = data; var item = G.store[id], history = (data.bars || []).map(function (bar) { return Number(bar.close); }).filter(Number.isFinite); if (item && history.length >= 2) { item.history = history.slice(-90); notify(); } notifyBars(id); return data; },
    async hydrateSparklines(ids, limit) { for (var index = 0; index < ids.length; index++) { var id = ids[index], item = G.get(id); if (item && (!item.history || item.history.length < 2)) { try { await G.api.loadBars(id, limit || 60); } catch (_) {} } await new Promise(function (resolve) { setTimeout(resolve, 120); }); } },
    startPolling: function (milliseconds) { if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(function () { G.api.refresh(false).catch(function () {}); }, milliseconds || 60000); },
    stopPolling: function () { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } },
  };
})(window.GMT);
