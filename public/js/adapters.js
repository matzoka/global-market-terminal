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
  // Derive the previous-close basis (close value + the UTC day it represents)
  // used for daily change, respecting each instrument group's provenance rules
  // (P1-CHG / P1-YEN). Both the change-percent math and P1-YEN's period-alignment
  // check MUST read from this single basis so they never diverge.
  //  - Stocks/ETF (previousClose supplied by backend): use backend value + asOf.
  //  - FX:    Frankfurter ECB quote vs Frankfurter ECB daily bar (same provider/series).
  //           Latest bar strictly before quote.asOf's UTC date.
  //  - Crypto: Coinbase Spot quote vs Yahoo Finance daily bar (cross-provider).
  //           Latest confirmed UTC-day bar strictly before today (UTC).
  //  - Metals: spot quote vs futures bar must NOT be mixed; keep null ('—').
  function derivePreviousBasis(item) {
    var q = item && item.quote;
    if (!q || !Number.isFinite(q.price)) return null;
    if (Number.isFinite(q.previousClose) && q.previousClose > 0) {
      // Backend-supplied (stocks/ETF). Basis day comes from previousCloseAsOf
      // when available, else fall back to asOf (same-day snapshot).
      return { close: q.previousClose, day: (q.previousCloseAsOf || q.asOf || '').slice(0, 10) };
    }
    var group = item.researchGroup, bars = G.bars[item.id] && Array.isArray(G.bars[item.id].bars) ? G.bars[item.id].bars : null;
    if (!bars || bars.length < 2) return null;
    var sorted = bars.slice().sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
    if (group === 'fx') {
      var asOfDay = (q.asOf || '').slice(0, 10);
      if (!asOfDay) return null;
      var prior = sorted.filter(function (b) { return b.time < asOfDay && Number.isFinite(b.close); });
      if (!prior.length) return null;
      var last = prior[prior.length - 1];
      return { close: last.close, day: String(last.time).slice(0, 10) };
    }
    if (group === 'crypto') {
      var today = new Date().toISOString().slice(0, 10);
      var confirmed = sorted.filter(function (b) { return b.time < today && Number.isFinite(b.close); });
      if (!confirmed.length) return null;
      var lastC = confirmed[confirmed.length - 1];
      return { close: lastC.close, day: String(lastC.time).slice(0, 10) };
    }
    return null; // metals and everything else stay '—'
  }
  // Legacy single-value accessor kept for readability at call sites.
  function derivePreviousClose(item) {
    var basis = derivePreviousBasis(item);
    return basis ? basis.close : null;
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
  // Yen-exposure (JPY-impact) decomposition for a single USD-denominated asset
  // vs USD/JPY (P1-YEN). Minimum scope: ACWI only. The decomposition is shown
  // ONLY when BOTH period endpoints align between the asset and USD/JPY:
  //   asset current date  == USDJPY current date
  //   asset prevClose date == USDJPY prevClose basis date
  // Otherwise the section is hidden entirely (no misleading partial breakdown).
  G.yenExposure = function (item) {
    if (!item || item.id !== 'ACWI') return null; // minimum scope
    var q = item.quote;
    if (!q || q.currency !== 'USD' || !Number.isFinite(q.price) || !Number.isFinite(q.previousClose) || !q.previousCloseAsOf) return null;
    var usdjpy = G.get('USDJPY');
    if (!usdjpy || !usdjpy.quote || !Number.isFinite(usdjpy.quote.price)) return null;
    var fxBasis = derivePreviousBasis(usdjpy);
    if (!fxBasis || !fxBasis.close || fxBasis.close <= 0) return null;
    var assetBasis = derivePreviousBasis(item);
    if (!assetBasis || !assetBasis.day) return null;
    var dayOf = function (iso) { return (iso || '').slice(0, 10); };
    var aligned =
      dayOf(q.asOf) === dayOf(usdjpy.quote.asOf) &&          // current-date alignment
      assetBasis.day === fxBasis.day;                        // previous-basis-date alignment
    if (!aligned) return null;
    var assetReturn = q.price / q.previousClose - 1;
    var fxReturn = usdjpy.quote.price / fxBasis.close - 1;
    var yenReturn = (1 + assetReturn) * (1 + fxReturn) - 1;
    return {
      applicable: true,
      assetReturn: { value: assetReturn, source: q.provider, currentAsOf: q.asOf, previousCloseAsOf: q.previousCloseAsOf },
      fxReturn: { value: fxReturn, source: 'FRANKFURTER_ECB', currentAsOf: usdjpy.quote.asOf, previousCloseAsOf: fxBasis.day },
      yenReturn: { value: yenReturn, formula: '(1+assetReturn)*(1+fxReturn)-1', isApproximate: true },
      isReference: Boolean(item.referenceOnly),
      note: 'ACWI ETF を JPY 換算した参考変動。オルカン投資信託の基準価額ではありません。',
    };
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
