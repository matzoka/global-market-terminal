/* Global Market Terminal — production dashboard boot, layout persistence, and data state. */
window.GMT = window.GMT || {};

(function (G) {
  'use strict';
  var LAYOUT_KEY = 'gmt1-layout-v4', board = document.getElementById('board'), statusMsg = document.getElementById('status-msg'), badge = document.getElementById('conn-badge'), updated = document.getElementById('last-update');
  var detailDrawer = document.getElementById('detail-drawer'), detailContent = document.getElementById('detail-content'), detailOpen = false, detailBarsLoading = Object.create(null), detailBarsUnavailable = Object.create(null), detailFocusReturn = null;
  var STATUS_LABEL = { PARTIAL_REALTIME: 'IEX一部', REALTIME: 'リアルタイム', DELAYED: '遅延', EOD: '終値', UNVERIFIED: '未確認', STALE: '要更新', UNAVAILABLE: '未取得' };
  // GMT-UX-02/06: header health is derived from the server's single worst-value
  // freshness order, never from array position.
  var HEALTH_TEXT = { FRESH: '● データ正常', STALE: '● 一部要更新', UNKNOWN: '● 鮮度未評価', UNAVAILABLE: '● 一部未取得' };
  var HEALTH_CLASS = { FRESH: 'badge-live', STALE: 'badge-down', UNKNOWN: 'badge-delayed', UNAVAILABLE: 'badge-down' };
  var FRESHNESS_RANK = { FRESH: 0, UNKNOWN: 1, STALE: 2, UNAVAILABLE: 3 };
  function healthSummaryText(health) {
    var counts = (health && health.counts) || {};
    return '正常 ' + (counts.FRESH || 0) + ' / 要更新 ' + (counts.STALE || 0) + ' / 未評価 ' + (counts.UNKNOWN || 0) + ' / 未取得 ' + (counts.UNAVAILABLE || 0);
  }
  function describeHealth(status, health) {
    var summary = healthSummaryText(health);
    if (status === 'FRESH') return 'すべての銘柄でデータ鮮度は正常です（' + summary + '）。';
    if (status === 'STALE') return '一部の銘柄が「要更新」です。最後に確認できた値（last-known-good）を経過時間つきで表示しています（' + summary + '）。';
    if (status === 'UNKNOWN') return '鮮度が未評価の銘柄があります。評価が完了するまで「正常」とは表示しません（' + summary + '）。';
    return '一部の銘柄を取得できていません。数値は表示できるものだけを示しています（' + summary + '）。';
  }
  function say(message) { if (statusMsg) statusMsg.textContent = message; }
  function formatAreaValue(value) { if (!Number.isFinite(value) || value <= 0) return null; return value >= 1e9 ? '$' + (value / 1e9).toFixed(2) + 'B' : value >= 1e6 ? '$' + (value / 1e6).toFixed(1) + 'M' : '$' + Math.round(value).toLocaleString('en-US'); }
  function formatPrice(value, decimals) { return Number.isFinite(value) ? Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals || 2, maximumFractionDigits: decimals || 2 }) : '—'; }
  function formatChange(item) { var value = G.changePercent(item); return Number.isFinite(value) ? (value >= 0 ? '+' : '') + value.toFixed(2) + '%' : '—'; }
  function formatTimestamp(value) { var date = new Date(value || ''); if (Number.isNaN(date.getTime())) return '—'; return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'); }
  function detailElement(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
  function detailField(label, value, extraClass) { var field = detailElement('div', 'detail-field'), key = detailElement('span', 'detail-key', label), content = detailElement('strong', extraClass || '', value || '—'); field.append(key, content); return field; }
  function drawDetailTrend(canvas, values, positive) {
    var context = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
    context.clearRect(0, 0, width, height);
    if (!values || values.length < 2) { context.fillStyle = '#4f8f68'; context.font = '10px ui-monospace, monospace'; context.fillText('確認済みの価格系列はありません', 12, 28); return; }
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = max - min || 1;
    context.strokeStyle = positive ? '#3dff6e' : '#ff4458'; context.lineWidth = 1.4; context.beginPath();
    values.forEach(function (value, index) { var x = 8 + index * (width - 16) / (values.length - 1), y = height - 9 - (value - min) * (height - 18) / span; if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.stroke(); context.fillStyle = '#4f8f68'; context.font = '9px ui-monospace, monospace'; context.fillText(formatPrice(min, 2), 8, height - 2); context.fillText(formatPrice(max, 2), width - 54, 11);
  }
  function renderDetail(id) {
    if (!detailContent) return;
    var item = G.get(id), quote = item && item.quote;
    detailContent.replaceChildren();
    if (!item || !quote) { detailContent.appendChild(detailElement('p', 'detail-empty', '確認済みの市場データを取得中です。')); return; }
    var change = G.changePercent(item), symbol = item.displaySymbol || item.id, status = quote.status || 'UNAVAILABLE', history = (G.bars[id] && Array.isArray(G.bars[id].bars) ? G.bars[id].bars.map(function (bar) { return bar.close; }) : item.history) || [];
    var meta = G.changeProvenance(item), changeNote = '';
    if (meta && Number.isFinite(change)) {
      if (meta.changeBasis === 'COINBASE_SPOT_VS_YAHOO_PREV_UTC_DAY') changeNote = '派生日次変動：Coinbase Spot 現在値 vs Yahoo Finance 前UTC日確定終値（異提供元比較）';
      else if (meta.changeBasis === 'FRANKFURTER_ECB_PREV_BUSINESS_DAY') changeNote = '派生日次変動：Frankfurter ECB 現在値 vs 直前ECB営業日終値';
    }
    var hero = detailElement('section', 'detail-hero'), symbolLine = detailElement('div', 'detail-symbol', symbol), nameLine = detailElement('div', 'detail-name', item.name), price = detailElement('div', 'detail-price', formatPrice(quote.price, item.decimals)), changeLine = detailElement('div', 'detail-change ' + (Number.isFinite(change) && change < 0 ? 'num-down' : 'num-up'), formatChange(item)), sourceStatus = detailElement('span', 'detail-status detail-status-' + status.toLowerCase(), STATUS_LABEL[status] || '未取得');
    hero.append(symbolLine, nameLine, price, changeLine, sourceStatus); detailContent.appendChild(hero);
    var grid = detailElement('section', 'detail-grid');
    grid.append(
      detailField('鮮度', G.freshness.label(quote) + '（' + G.freshness.ageText(quote) + '）', 'detail-freshness fresh-' + String(quote.freshness || 'UNKNOWN').toLowerCase()),
      detailField('データ期限', formatTimestamp(quote.expiresAt)),
      detailField('出所', quote.provider || '—'),
      detailField('配信区分', quote.deliveryLabel || STATUS_LABEL[status] || '—'),
      detailField('基準時刻', formatTimestamp(quote.asOf)),
      detailField('取得時刻', formatTimestamp(quote.fetchedAt || quote.receivedAt)),
      detailField('調査区分', item.researchGroup === 'fx' ? '為替参考値' : item.researchGroup === 'crypto' ? '暗号資産の集計参考値' : item.referenceOnly ? 'オルカン参考（ETF）' : '市場参考値'),
      detailField('価格の注意', item.researchGroup === 'fx' ? '約定レート・スワップは証券会社ごとに異なります' : item.researchGroup === 'crypto' ? '取引所の約定価格・手数料とは異なります' : item.referenceOnly ? '投資信託の基準価額そのものではありません' : '出所・配信区分を確認してください')
    );
    if (changeNote) grid.append(detailField('日次変動の注意', changeNote));
    detailContent.appendChild(grid);
    var yen = G.yenExposure(item);
    if (yen && yen.applicable) {
      var pct = function (v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; };
      var day = function (iso) { return (iso || '').slice(0, 10); };
      var yenSection = detailElement('section', 'detail-grid detail-yen');
      yenSection.append(
        detailElement('div', 'detail-section-title', '円換算参考変動（ACWI ETF・JPY参考）'),
        detailField('資産要因(USD)', pct(yen.assetReturn.value) + ' ・ ' + (yen.assetReturn.source || '—') + ' ・ 基準 ' + day(yen.assetReturn.currentAsOf)),
        detailField('為替要因(JPY)', pct(yen.fxReturn.value) + ' ・ ' + (yen.fxReturn.source || '—') + ' ・ 基準 ' + day(yen.fxReturn.currentAsOf)),
        detailField('円換算参考', pct(yen.yenReturn.value) + ' ・ ' + yen.yenReturn.formula + (yen.yenReturn.isApproximate ? '（近似・参考）' : '')),
        detailField('注意', 'オルカン投資信託の基準価額ではありません。Alpaca IEX と ECB reference rate の基準時刻が異なるため参考値です。')
      );
      detailContent.appendChild(yenSection);
    }
    var trend = detailElement('section', 'detail-trend'), trendTitle = detailElement('div', 'detail-section-title', '確認済み価格の推移'), trendNote = detailElement('div', 'detail-note', history.length >= 2 ? '確認済み ' + history.length + ' 点 ・ 表示専用' : detailBarsLoading[id] ? '確認済みの日足系列を取得中…' : detailBarsUnavailable[id] ? '現在の提供元から確認済みの日足系列は取得できません。' : 'この銘柄・指数に確認済みの価格系列はありません。');
    trend.appendChild(trendTitle);
    if (history.length >= 2) { var canvas = document.createElement('canvas'); canvas.width = 376; canvas.height = 88; drawDetailTrend(canvas, history, !Number.isFinite(change) || change >= 0); trend.appendChild(canvas); }
    trend.appendChild(trendNote); detailContent.appendChild(trend);
    var futures = G.metalFuturesChange(item);
    if (futures) {
      var pctF = (futures.changePercent >= 0 ? '+' : '') + futures.changePercent.toFixed(2) + '%';
      var futuresSection = detailElement('section', 'detail-grid detail-futures');
      futuresSection.append(
        detailElement('div', 'detail-section-title', '先物前取引日比（別系列・参考）'),
        detailField('銘柄', futures.symbol || '—'),
        detailField('最新先物参考値', formatPrice(futures.current, item.decimals) + ' ・ 基準 ' + futures.currentAsOf),
        detailField('前取引日終値', formatPrice(futures.previous, item.decimals) + ' ・ 基準 ' + futures.previousAsOf),
        detailField('変動', pctF + ' ・ ' + (futures.isReference ? '参考' : '')),
        detailField('出所', futures.provider || '—'),
        detailField('配信区分', futures.deliveryLabel || '—'),
        detailField('注意', 'スポット価格とは異なる先物系列です。Yahoo Finance の連続先物シンボルは限月切替により価格が不連続になる可能性があります。')
      );
      detailContent.appendChild(futuresSection);
    }
    detailContent.appendChild(detailElement('p', 'detail-disclaimer', '閲覧専用：数値を判断する前に、出所・配信区分・基準時刻を確認してください。'));
  }
  function openDetail(id) {
    detailOpen = true;
    var item = G.get(id);
    if (item && !G.bars[id] && !detailBarsLoading[id]) {
      detailBarsLoading[id] = true;
      delete detailBarsUnavailable[id];
      G.api.loadBars(id).then(function (payload) { if (!payload || !Array.isArray(payload.bars) || !payload.bars.length) detailBarsUnavailable[id] = true; }).catch(function () { detailBarsUnavailable[id] = true; }).finally(function () { delete detailBarsLoading[id]; if (detailOpen && G.selectedInstrumentId === id) renderDetail(id); });
    }
    renderDetail(id);
    if (detailDrawer) {
      detailFocusReturn = document.querySelector('.instrument-select.is-selected');
      detailDrawer.classList.add('is-open'); detailDrawer.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () { document.getElementById('btn-detail-close').focus(); });
    }
  }
  function closeDetail() {
    detailOpen = false;
    if (detailDrawer) { detailDrawer.classList.remove('is-open'); detailDrawer.setAttribute('aria-hidden', 'true'); }
    if (detailFocusReturn && document.contains(detailFocusReturn)) detailFocusReturn.focus();
  }
  G.openDetail = openDetail;
  function showFocus(id) {
    var item = G.get(id), quote = item && item.quote;
    if (!item || !quote) { say('注目 [' + id + ']：確認済みの市場データを取得中です。'); return; }
    var asOf = quote.asOf ? '基準 ' + quote.asOf : quote.fetchedAt ? '取得 ' + quote.fetchedAt : '確認済み時刻なし';
    say('注目 [' + (item.displaySymbol || id) + ']：' + (item.name || id) + ' ・ ' + (quote.provider || '出所未取得') + ' ・ ' + (quote.deliveryLabel || STATUS_LABEL[quote.status] || '未取得') + ' ・ 鮮度 ' + G.freshness.label(quote) + '（' + G.freshness.ageText(quote) + '） ・ ' + asOf + '。');
  }
  // GMT-UX-06: per-provider freshness strip. Summary is always visible; the
  // detailed provider chips can be collapsed (default collapsed on mobile) so
  // technical detail never crowds the market data.
  function renderFreshnessStrip(data) {
    var strip = document.getElementById('freshness-providers'), summary = document.getElementById('freshness-summary');
    var health = data && data.health;
    if (summary) summary.textContent = data && health ? 'データ鮮度：' + (HEALTH_TEXT[health.status] || '● 未評価').replace('● ', '') + '（' + healthSummaryText(health) + '）' : 'データ鮮度：取得できませんでした';
    if (!strip) return;
    strip.replaceChildren();
    if (!data || !Array.isArray(data.instruments)) return;
    var byProvider = {};
    data.instruments.forEach(function (item) {
      var quote = item.quote || {}, pid = quote.provider || '未取得';
      var entry = byProvider[pid] || (byProvider[pid] = { provider: pid, freshness: quote.freshness || 'UNKNOWN', ageSeconds: quote.ageSeconds, count: 0 });
      entry.count++;
      if ((FRESHNESS_RANK[quote.freshness] || 0) > (FRESHNESS_RANK[entry.freshness] || 0)) { entry.freshness = quote.freshness || 'UNKNOWN'; entry.ageSeconds = quote.ageSeconds; }
    });
    Object.keys(byProvider).forEach(function (key) {
      var entry = byProvider[key], chip = document.createElement('span');
      chip.className = 'fresh-chip fresh-' + entry.freshness.toLowerCase();
      chip.textContent = entry.provider + ' · ' + G.freshness.label({ freshness: entry.freshness }) + ' · ' + G.freshness.ageText({ ageSeconds: entry.ageSeconds }) + ' · ' + entry.count + '件';
      chip.title = entry.provider + ' の最悪鮮度: ' + entry.freshness;
      strip.appendChild(chip);
    });
  }
  function log(line, cls) { var out = document.getElementById('boot-log'); if (!out) return; var span = document.createElement('span'); span.className = cls || ''; span.textContent = line; out.appendChild(span); out.appendChild(document.createTextNode('\n')); }
  var storage = (function () { try { localStorage.setItem('__gmt_test__', '1'); localStorage.removeItem('__gmt_test__'); return localStorage; } catch (_) { return null; } })();
  function saveLayout() { if (!storage) return; var order = [], spans = {}; board.querySelectorAll('.panel:not(.fixed-panel)').forEach(function (p) { order.push(p.dataset.widget); spans[p.dataset.widget] = p.dataset.span; }); try { storage.setItem(LAYOUT_KEY, JSON.stringify({ order: order, spans: spans })); } catch (_) {} }
  function loadLayout() {
    if (!storage) return false;
    try { var data = JSON.parse(storage.getItem(LAYOUT_KEY) || 'null'); if (!data || !Array.isArray(data.order)) return false; var panels = {}; board.querySelectorAll('.panel').forEach(function (p) { panels[p.dataset.widget] = p; }); data.order.forEach(function (id) { if (panels[id] && !panels[id].classList.contains('fixed-panel')) { board.appendChild(panels[id]); if (data.spans && data.spans[id]) panels[id].dataset.span = data.spans[id]; } }); Object.keys(panels).forEach(function (id) { if (data.order.indexOf(id) < 0 && !panels[id].classList.contains('fixed-panel')) board.appendChild(panels[id]); }); board.querySelectorAll('.fixed-panel').forEach(function (panel) { board.appendChild(panel); }); return true; } catch (_) { return false; }
  }
  function initDnD() {
    var dragged = null;
    board.querySelectorAll('.panel:not(.fixed-panel)').forEach(function (panel) {
      panel.draggable = true;
      panel.addEventListener('dragstart', function (event) { if (event.target.closest('.span-btn, .panel-csv-btn')) { event.preventDefault(); return; } dragged = panel; panel.classList.add('dragging'); say('パネルを移動中：目的の位置へドロップしてください。'); });
      panel.addEventListener('dragend', function () { panel.classList.remove('dragging'); board.querySelectorAll('.drop-target').forEach(function (x) { x.classList.remove('drop-target'); }); dragged = null; saveLayout(); say('配置をこのブラウザに保存しました。'); });
      panel.addEventListener('dragover', function (event) { if (!dragged || dragged === panel || panel.classList.contains('fixed-panel')) return; event.preventDefault(); panel.classList.add('drop-target'); });
      panel.addEventListener('dragleave', function () { panel.classList.remove('drop-target'); });
      panel.addEventListener('drop', function (event) { if (!dragged || dragged === panel || panel.classList.contains('fixed-panel')) return; event.preventDefault(); panel.classList.remove('drop-target'); board.insertBefore(dragged, event.clientY - panel.getBoundingClientRect().top < panel.offsetHeight / 2 ? panel : panel.nextSibling); });
    });
    var cycle = ['4', '5', '6', '7', '8', '12'];
    board.querySelectorAll('.span-btn').forEach(function (button) { button.addEventListener('click', function (event) { event.stopPropagation(); var p = event.currentTarget.closest('.panel'); p.dataset.span = cycle[(cycle.indexOf(p.dataset.span) + 1) % cycle.length]; saveLayout(); say('パネル幅を変更し、このブラウザに保存しました。'); }); });
  }
  function updateUtcClock() { var target = document.getElementById('utc-clock'); if (target) target.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC'; }
  function setConnection(data) {
    var health = data && data.health;
    var status = health ? health.status : 'UNAVAILABLE';
    badge.className = 'badge ' + (HEALTH_CLASS[status] || 'badge-delayed');
    badge.textContent = HEALTH_TEXT[status] || '● データ状態不明';
    badge.title = health ? 'データ鮮度: ' + status + '（' + healthSummaryText(health) + '）' : '市場データの接続状態';
    if (updated) updated.textContent = data && data.generatedAt ? '更新 ' + new Date(data.generatedAt).toLocaleTimeString('ja-JP', { hour12: false }) : '更新 --';
    renderFreshnessStrip(data);
    if (G.selectedInstrumentId) { showFocus(G.selectedInstrumentId); if (detailOpen) renderDetail(G.selectedInstrumentId); return; }
    say(health ? describeHealth(status, health) : 'データ状態を取得できませんでした。前回の確認済み値があればその鮮度を表示します。');
  }
  function refreshNow() { say('確認済みの市場データを更新中…'); G.api.refresh(true).then(function () { return G.api.loadBars(G.selectedInstrumentId || 'ACWI'); }).catch(function () { say('データ取得に失敗しました。前回の確認済み値があれば「要更新」と表示します。'); }); }
  function initReset() { document.getElementById('btn-reset').addEventListener('click', function () { if (storage) storage.removeItem(LAYOUT_KEY); location.reload(); }); document.getElementById('btn-refresh').addEventListener('click', refreshNow); }
  function initDetail() {
    document.getElementById('btn-detail-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && detailOpen) { event.preventDefault(); closeDetail(); } });
  }
  function initFreshnessToggle() {
    var toggle = document.getElementById('btn-fresh-toggle'), strip = document.getElementById('freshness-strip');
    if (!toggle || !strip) return;
    toggle.addEventListener('click', function () {
      var expanded = strip.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '詳細を閉じる' : '詳細';
    });
  }
  function boot() {
    log('Global Market Terminal 起動 v4.0.0 ・ 無料市場参考データモード', 'ok'); log('データ経路 ....... ブラウザ → Global Market Terminal API → 承認済み提供元', 'ok'); log('合成データ ....... 無効', 'ok'); log('調査対象 ......... 世界株参考・為替・暗号資産', 'ok'); log('判断レーダー ..... 売買推奨ではなく、出所と値動きの確認用です', 'warn'); log('配置 ............. 世界市場時計は最下段に固定', 'ok');
    var W = G.widgets; W.initUniverse(document.getElementById('w-universe')); W.initChart(document.getElementById('w-chart')); W.initRadar(document.getElementById('w-radar')); W.initWatchlist(document.getElementById('w-compare')); W.initClocks(document.getElementById('w-clocks'));
    G.onInstrumentSelected(function (id) { showFocus(id); W.updateRadar(); });
    G.onUpdate(function (data) { W.updateUniverse(); W.updateChart(); W.updateRadar(); W.updateWatchlist(); setConnection(data); }); G.onBars(function (id) { if (detailOpen && G.selectedInstrumentId === id) renderDetail(id); if (id === G.selectedInstrumentId) { W.updateChart(); W.updateRadar(); } });
    initDnD(); initReset(); initDetail(); initFreshnessToggle(); updateUtcClock(); setInterval(updateUtcClock, 1000);
    G.api.refresh(false).then(function () { G.selectInstrument('ACWI'); }).catch(function () { setConnection(null); }); G.api.startPolling(60000);
    setTimeout(function () { document.getElementById('boot-log').classList.add('collapsed'); }, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.GMT);
