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
  // Derive the previous-close basis used for daily change, respecting each
  // instrument group's provenance rules (P1-CHG):
  //  - FX:    Frankfurter ECB quote vs Frankfurter ECB daily bar (same provider/series).
  //           Use the latest bar strictly before quote.asOf's UTC date.
  //  - Crypto: Coinbase Spot quote vs Yahoo Finance daily bar (cross-provider).
  //           Use the latest confirmed UTC-day bar strictly before today (UTC).
  //  - Metals: spot quote vs futures bar must NOT be mixed; keep null ('—').
  function derivePreviousClose(item) {
    var q = item && item.quote;
    if (!q || !Number.isFinite(q.price)) return null;
    if (Number.isFinite(q.previousClose) && q.previousClose > 0) return q.previousClose; // backend-supplied (stocks)
    var group = item.researchGroup, bars = G.bars[item.id] && Array.isArray(G.bars[item.id].bars) ? G.bars[item.id].bars : null;
    if (!bars || bars.length < 2) return null;
    var sorted = bars.slice().sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
    if (group === 'fx') {
      var asOfDay = (q.asOf || '').slice(0, 10);
      if (!asOfDay) return null;
      var prior = sorted.filter(function (b) { return b.time < asOfDay && Number.isFinite(b.close); });
      return prior.length ? prior[prior.length - 1].close : null;
    }
    if (group === 'crypto') {
      var today = new Date().toISOString().slice(0, 10);
      var confirmed = sorted.filter(function (b) { return b.time < today && Number.isFinite(b.close); });
      return confirmed.length ? confirmed[confirmed.length - 1].close : null;
    }
    return null; // metals and everything else stay '—'
  }
  G.changePercent = function (item) {
    var q = item && item.quote;
    if (!q || !Number.isFinite(q.price)) return null;
    var prev = derivePreviousClose(item);
    return Number.isFinite(prev) && prev > 0 ? (q.price / prev - 1) * 100 : null;
  };
  // Provenance metadata for the derived daily change (P1-CHG). Returns null when
  // no derived change is shown (e.g. metals), so callers can render '—'.
  G.changeProvenance = function (item) {
    var group = item.researchGroup;
    if (group === 'fx') return { priceSource: 'FRANKFURTER_ECB', basisSource: 'FRANKFURTER_ECB', changeBasis: 'FRANKFURTER_ECB_PREV_BUSINESS_DAY' };
    if (group === 'crypto') return { priceSource: 'COINBASE_PUBLIC_SPOT', basisSource: 'YAHOO_FINANCE_DAILY', changeBasis: 'COINBASE_SPOT_VS_YAHOO_PREV_UTC_DAY' };
    return null;
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
