/* Global Market Terminal — research widgets. They render only records returned by the private API. */
window.GMT = window.GMT || {};

(function (G) {
  'use strict';
  var W = G.widgets = {};
  var selectedId = null, selectionListeners = [];
  var STATUS_LABEL = { PARTIAL_REALTIME: 'IEX一部', REALTIME: 'リアルタイム', DELAYED: '遅延', EOD: '終値', UNVERIFIED: '未確認', STALE: '要更新', UNAVAILABLE: '未取得' };
  var GROUPS = [
    { id: 'global', label: '世界株・オルカン参考', note: 'オルカンの基準価額ではなく、世界株と各市場の参考値です。', ids: ['ACWI', 'SPX', 'NDX', 'N225', 'DAX', 'HSI'] },
    { id: 'fx', label: '為替（主要通貨ペア）', note: '証券会社の約定レート・スプレッド・スワップとは異なる参考値です。', ids: ['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'EURJPY'] },
    { id: 'crypto', label: '暗号資産（参考）', note: '取引所の約定価格ではなく、集計された市場参考値です。', ids: ['BTCJPY', 'ETHJPY', 'SOLJPY', 'XRPJPY'] },
  ];
  var COMPARE_IDS = ['ACWI', 'USDJPY', 'EURUSD', 'N225', 'SPX', 'BTCJPY', 'ETHJPY', 'XAU'];
  var chart = { id: null, limit: 60, root: null, canvas: null, tooltip: null, rows: [] };

  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
  function fmt(value, decimals) { return Number.isFinite(value) ? Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals == null ? 2 : decimals, maximumFractionDigits: decimals == null ? 2 : decimals }) : '—'; }
  function fmtChange(value) { return Number.isFinite(value) ? (value >= 0 ? '+' : '') + value.toFixed(2) + '%' : '—'; }
  function polarity(value) { return Number.isFinite(value) && value < 0 ? 'num-down' : 'num-up'; }
  function statusOf(item) { return item && item.quote ? item.quote.status : 'UNAVAILABLE'; }
  function sourceDetails(quote) { return [quote.provider, quote.deliveryLabel, quote.providerSymbol, quote.asOf && '基準 ' + quote.asOf, quote.fetchedAt && '取得 ' + quote.fetchedAt, quote.reason].filter(Boolean).join(' · '); }
  function sourceBadge(item) { var status = statusOf(item), badge = el('span', 'src-badge src-' + status.toLowerCase(), STATUS_LABEL[status] || '未取得'); if (item && item.quote) badge.title = sourceDetails(item.quote); return badge; }
  function setBadge(badge, item) { var status = statusOf(item); badge.className = 'src-badge src-' + status.toLowerCase(); badge.textContent = STATUS_LABEL[status] || '未取得'; badge.title = item && item.quote ? sourceDetails(item.quote) : ''; }
  function selectedItem() { return selectedId ? G.get(selectedId) : null; }
  function groupFor(item) { return GROUPS.find(function (group) { return group.ids.indexOf(item && item.id) >= 0; }) || null; }

  G.onInstrumentSelected = function (listener) { selectionListeners.push(listener); };
  G.selectInstrument = function (id) { if (!id) return; selectedId = id; G.selectedInstrumentId = id; selectionListeners.forEach(function (listener) { listener(id); }); };
  function selectable(node, id, label) {
    node.classList.add('instrument-select'); node.tabIndex = 0; node.setAttribute('role', 'button'); node.setAttribute('aria-label', label + ' を選択して調査する'); node.setAttribute('aria-pressed', 'false');
    function choose() { G.selectInstrument(id); }
    node.addEventListener('click', choose);
    node.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    selectionListeners.push(function (activeId) { var active = activeId === id; node.classList.toggle('is-selected', active); node.setAttribute('aria-pressed', String(active)); });
  }
  function spark(canvas, values, positive) {
    if (!canvas) return;
    var context = canvas.getContext('2d'), width = canvas.width, height = canvas.height; context.clearRect(0, 0, width, height);
    if (!values || values.length < 2) return;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = max - min || 1;
    context.beginPath(); values.forEach(function (value, index) { var x = 1 + index * (width - 2) / (values.length - 1), y = height - 2 - (value - min) * (height - 4) / span; if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.strokeStyle = positive ? '#3dff6e' : '#ff4458'; context.lineWidth = 1; context.stroke();
  }

  W.initUniverse = function (root) {
    var cells = {}; root.classList.add('universe-grid');
    GROUPS.forEach(function (group) {
      var block = el('section', 'universe-block universe-' + group.id), title = el('div', 'universe-title'), list = el('div', 'universe-list'); title.append(el('span', null, group.label), el('span', 'universe-count', group.ids.length + '件'));
      group.ids.forEach(function (id) {
        var row = el('div', 'universe-row'), symbol = el('span', 'u-symbol', id), price = el('span', 'u-price', '—'), change = el('span', 'u-change', '—'), mini = document.createElement('canvas'), badge = sourceBadge(null);
        mini.width = 58; mini.height = 16; mini.className = 'u-spark'; selectable(row, id, id); row.append(symbol, price, change, mini, badge); list.appendChild(row); cells[id] = { symbol: symbol, price: price, change: change, mini: mini, badge: badge };
      });
      block.append(title, list, el('p', 'universe-note', group.note)); root.appendChild(block);
    });
    W.updateUniverse = function () { Object.keys(cells).forEach(function (id) { var item = G.get(id), cell = cells[id]; if (!item) return; var change = G.changePercent(item); cell.symbol.textContent = item.displaySymbol || item.id; cell.price.textContent = fmt(item.quote.price, item.decimals); cell.change.textContent = fmtChange(change); cell.change.className = 'u-change ' + polarity(change); setBadge(cell.badge, item); spark(cell.mini, item.history || [], !Number.isFinite(change) || change >= 0); }); };
  };

  function range(rows, key, direction) { return rows.reduce(function (result, row) { return direction === 'min' ? Math.min(result, row[key]) : Math.max(result, row[key]); }, direction === 'min' ? Infinity : -Infinity); }
  function chartRowsFor(id) { var payload = G.bars[id], rows = payload && Array.isArray(payload.bars) ? payload.bars : []; return rows.slice(-chart.limit); }
  function drawChart(rows) {
    var canvas = chart.canvas; if (!canvas) return;
    var dpr = window.devicePixelRatio || 1, width = canvas.clientWidth || 640, height = 340;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    var context = canvas.getContext('2d'); context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); context.font = '10px ' + getComputedStyle(document.body).fontFamily;
    if (!rows.length) { context.fillStyle = '#4f8f68'; context.fillText('この対象の日足データは、設定済みの無料提供元から取得できません。', 16, 32); return; }
    var left = 8, right = 58, top = 10, bottom = 28, plotWidth = width - left - right, plotHeight = height - top - bottom;
    var closeOnly = rows.every(function (row) { return row.closeOnly === true; });
    var low = closeOnly ? range(rows, 'close', 'min') : range(rows, 'low', 'min'), high = closeOnly ? range(rows, 'close', 'max') : range(rows, 'high', 'max'), pad = (high - low) * .07 || Math.max(1, high * .01); low -= pad; high += pad;
    function x(index) { return left + (index + .5) * plotWidth / rows.length; } function y(price) { return top + (1 - (price - low) / (high - low)) * plotHeight; }
    context.strokeStyle = 'rgba(18,58,34,.88)'; context.fillStyle = '#4f8f68'; context.lineWidth = 1;
    for (var g = 0; g <= 5; g++) { var value = low + (high - low) * g / 5, gy = Math.round(y(value)) + .5; context.beginPath(); context.moveTo(left, gy); context.lineTo(left + plotWidth, gy); context.stroke(); context.fillText(fmt(value, selectedItem() && selectedItem().decimals), left + plotWidth + 6, gy + 3); }
    if (closeOnly) { context.strokeStyle = '#3dff6e'; context.lineWidth = 1.5; context.beginPath(); rows.forEach(function (bar, index) { if (index) context.lineTo(x(index), y(bar.close)); else context.moveTo(x(index), y(bar.close)); }); context.stroke(); }
    else { var candleWidth = Math.max(1, plotWidth / rows.length * .58); rows.forEach(function (bar, index) { var up = bar.close >= bar.open, color = up ? '#3dff6e' : '#ff4458'; context.strokeStyle = color; context.beginPath(); context.moveTo(x(index), y(bar.high)); context.lineTo(x(index), y(bar.low)); context.stroke(); context.fillStyle = up ? 'rgba(61,255,110,.84)' : 'rgba(255,68,88,.84)'; context.fillRect(x(index) - candleWidth / 2, y(Math.max(bar.open, bar.close)), candleWidth, Math.max(1, Math.abs(y(bar.open) - y(bar.close)))); }); }
    var last = rows[rows.length - 1], ly = Math.round(y(last.close)) + .5; context.setLineDash([4, 3]); context.strokeStyle = '#ffb000'; context.beginPath(); context.moveTo(left, ly); context.lineTo(left + plotWidth, ly); context.stroke(); context.setLineDash([]); context.fillStyle = '#ffb000'; context.fillText(fmt(last.close, selectedItem() && selectedItem().decimals), left + plotWidth + 6, ly + 3);
    for (var marker = 0; marker < rows.length; marker += Math.max(1, Math.floor(rows.length / 5))) context.fillText(String(rows[marker].time || '').slice(5), x(marker) - 14, height - 5);
    chart.rows = rows; chart.geometry = { left: left, plotWidth: plotWidth };
  }
  function updateChartHeader() {
    var item = selectedItem(), q = item && item.quote, title = document.getElementById('selected-chart-title'), tag = document.getElementById('selected-chart-tag'), summary = document.getElementById('selected-chart-summary'), note = document.getElementById('selected-chart-note');
    if (!item || !q) { title.textContent = '選択中の推移'; tag.textContent = '—'; summary.textContent = '対象を選択してください'; return; }
    var labels = { 5: '1週', 22: '1か月', 60: '3か月', 250: '1年' }, bars = G.bars[item.id] || {};
    title.textContent = (item.displaySymbol || item.id) + ' — ' + (labels[chart.limit] || '日足'); tag.textContent = q.providerSymbol || item.providerSymbol || item.id; summary.replaceChildren(); summary.append(item.name + '　価格 ' + fmt(q.price, item.decimals) + '　'); summary.appendChild(sourceBadge(item));
    var closeOnly = bars.bars && bars.bars.length && bars.bars.every(function (bar) { return bar.closeOnly === true; });
    note.textContent = bars.bars && bars.bars.length ? (closeOnly ? '日次価格：' : '日足OHLC：') + (STATUS_LABEL[bars.status] || '未取得') + ' ・ ' + (bars.deliveryLabel || bars.provider || q.provider || '—') + ' ・ 確認済み ' + bars.bars.length + ' 本。売買を推奨する表示ではありません。' : '日足データなし：' + (bars.reason || '設定済みの無料提供元から取得できません') + '。';
  }
  function requestChart(id) { chart.id = id; updateChartHeader(); drawChart(chartRowsFor(id)); G.api.loadBars(id, chart.limit).then(function () { if (chart.id === id) { updateChartHeader(); drawChart(chartRowsFor(id)); W.updateRadar(); } }).catch(function () {}); }
  W.initChart = function (root) {
    chart.root = root; chart.canvas = document.getElementById('research-canvas'); chart.tooltip = document.getElementById('chart-tooltip');
    root.querySelectorAll('.range-btn').forEach(function (button) { button.addEventListener('click', function () { chart.limit = Number(button.dataset.limit); root.querySelectorAll('.range-btn').forEach(function (node) { node.classList.toggle('is-active', node === button); }); if (chart.id) requestChart(chart.id); }); });
    chart.canvas.addEventListener('pointermove', function (event) { if (!chart.rows.length || !chart.geometry) return; var rect = chart.canvas.getBoundingClientRect(), index = Math.max(0, Math.min(chart.rows.length - 1, Math.floor((event.clientX - rect.left - chart.geometry.left) / chart.geometry.plotWidth * chart.rows.length))), row = chart.rows[index], item = selectedItem(), prefix = row.closeOnly ? '価格 ' + fmt(row.close, item && item.decimals) : '始値 ' + fmt(row.open, item && item.decimals) + '\n高値 ' + fmt(row.high, item && item.decimals) + '\n安値 ' + fmt(row.low, item && item.decimals) + '\n終値 ' + fmt(row.close, item && item.decimals); chart.tooltip.textContent = String(row.time || '').replace('T', ' ') + '\n' + prefix; chart.tooltip.style.left = Math.min(rect.width - 124, Math.max(6, event.clientX - rect.left + 10)) + 'px'; chart.tooltip.style.top = Math.max(8, event.clientY - rect.top - 92) + 'px'; chart.tooltip.classList.add('is-visible'); chart.tooltip.setAttribute('aria-hidden', 'false'); });
    chart.canvas.addEventListener('pointerleave', function () { chart.tooltip.classList.remove('is-visible'); chart.tooltip.setAttribute('aria-hidden', 'true'); });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { if (chart.id) drawChart(chartRowsFor(chart.id)); }).observe(root); else window.addEventListener('resize', function () { if (chart.id) drawChart(chartRowsFor(chart.id)); });
    G.onInstrumentSelected(function (id) { requestChart(id); });
  };
  W.updateChart = function () { if (chart.id) { updateChartHeader(); drawChart(chartRowsFor(chart.id)); } };

  function closeAt(rows, offset) { var index = rows.length - 1 - offset; return index >= 0 && Number.isFinite(rows[index].close) ? rows[index].close : null; }
  function percentage(current, earlier) { return Number.isFinite(current) && Number.isFinite(earlier) && earlier > 0 ? (current / earlier - 1) * 100 : null; }
  function atr(rows, period) { if (rows.length < period + 1) return null; var total = 0; for (var i = rows.length - period; i < rows.length; i++) { var previous = rows[i - 1].close, row = rows[i]; total += Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous)); } return total / period; }
  function researchPrompt(item) { var group = groupFor(item); if (!group) return '出所・遅延・価格の基準時刻を確認してください。'; if (group.id === 'fx') return '金融政策・雇用統計など、公式の経済イベントを確認してください。'; if (group.id === 'crypto') return '利用する取引所の約定価格・手数料・保管方法との違いを確認してください。'; return 'オルカンそのものではない参考値であることと、円相場の影響を確認してください。'; }
  W.initRadar = function (root) { W.radarRoot = root; };
  W.updateRadar = function () {
    var root = W.radarRoot, item = selectedItem(), q = item && item.quote, tag = document.getElementById('radar-tag'); if (!root) return; root.replaceChildren(); if (!item || !q) { root.appendChild(el('p', 'radar-empty', '候補を選択すると、値動き・基準・次に確認する事項を表示します。')); return; }
    tag.textContent = item.displaySymbol || item.id;
    var payload = G.bars[item.id] || {}, rows = payload.bars || [], current = q.price, closeOnly = rows.length && rows.every(function (row) { return row.closeOnly === true; }), highs = rows.map(function (row) { return closeOnly ? row.close : row.high; }).filter(Number.isFinite), high = highs.length ? Math.max.apply(null, highs) : null, found = high == null ? null : rows.find(function (row) { return (closeOnly ? row.close : row.high) === high; }), periods = [[1, '1日'], [5, '1週'], [22, '1か月'], [60, '3か月']];
    var periodBlock = el('section', 'radar-section'), metrics = el('div', 'radar-metrics'); periods.forEach(function (entry) { var offset = entry[0] === 60 ? 59 : entry[0], value = entry[0] === 1 ? G.changePercent(item) : percentage(current, closeAt(rows, offset)); var metric = el('div', 'radar-metric'); metric.append(el('span', null, entry[1]), el('strong', polarity(value), fmtChange(value))); metrics.appendChild(metric); }); periodBlock.append(el('h3', 'radar-title', '期間別変化（事実）'), metrics);
    var highBlock = el('section', 'radar-section'), highGrid = el('div', 'radar-grid'); highGrid.append(el('span', null, (closeOnly ? '最高価格 ' : '高値 ') + (high == null ? '—' : fmt(high, item.decimals))), el('span', null, found ? found.time : '—'), el('strong', polarity(percentage(current, high)), '変化 ' + fmtChange(percentage(current, high)))); highBlock.append(el('h3', 'radar-title', '直近高値から'), highGrid);
    var volatility = closeOnly ? null : atr(rows, 14), volBlock = el('section', 'radar-section'), volGrid = el('div', 'radar-grid'); volGrid.append(el('span', null, closeOnly ? 'OHLC未提供（日次価格）' : volatility == null ? 'ATR(14) は日足不足' : 'ATR(14) ' + fmt(volatility, item.decimals)), el('span', null, volatility == null || !Number.isFinite(current) ? '—' : '現在値比 ' + (volatility / current * 100).toFixed(2) + '%')); volBlock.append(el('h3', 'radar-title', '値動きの大きさ'), volGrid);
    var next = el('section', 'radar-section'); next.append(el('h3', 'radar-title', '次に確認すること'), el('p', 'radar-copy', researchPrompt(item)));
    var source = el('section', 'radar-section'); source.append(el('h3', 'radar-title', '出所・更新時刻'), el('p', 'radar-copy', [q.provider || '—', q.deliveryLabel || STATUS_LABEL[q.status] || '—', q.asOf ? '基準 ' + q.asOf : '基準時刻なし'].join(' ・ ')));
    var actions = el('div', 'radar-actions'), details = el('button', 'tbtn radar-detail', '詳細を開く'); details.type = 'button'; details.addEventListener('click', function () { if (typeof G.openDetail === 'function') G.openDetail(item.id); }); actions.append(details, el('span', 'radar-disclaimer', '投資判断はご自身で'));
    root.append(periodBlock, highBlock, volBlock, next, source, actions);
  };

  W.initCompare = function (root) {
    var cards = {}; root.classList.add('compare-strip');
    COMPARE_IDS.forEach(function (id) { var card = el('div', 'compare-card'), symbol = el('div', 'compare-symbol', id), price = el('div', 'compare-price', '—'), change = el('div', 'compare-change', '—'), mini = document.createElement('canvas'); mini.width = 112; mini.height = 20; selectable(card, id, id); card.append(symbol, price, change, mini); root.appendChild(card); cards[id] = { symbol: symbol, price: price, change: change, mini: mini }; });
    W.updateCompare = function () { Object.keys(cards).forEach(function (id) { var item = G.get(id), cell = cards[id]; if (!item) return; var change = G.changePercent(item); cell.symbol.textContent = item.displaySymbol || item.id; cell.price.textContent = fmt(item.quote.price, item.decimals); cell.change.textContent = fmtChange(change); cell.change.className = 'compare-change ' + polarity(change); spark(cell.mini, item.history || [], !Number.isFinite(change) || change >= 0); }); };
  };

  var MARKETS = [
    { city: 'ニューヨーク', tz: 'America/New_York', exch: 'NYSE/NASDAQ', sessions: [[570, 960]] }, { city: 'ロンドン', tz: 'Europe/London', exch: 'LSE', sessions: [[480, 990]] }, { city: 'フランクフルト', tz: 'Europe/Berlin', exch: 'XETRA', sessions: [[540, 1050]] }, { city: '香港', tz: 'Asia/Hong_Kong', exch: 'HKEX', sessions: [[570, 720], [780, 960]], lunch: true }, { city: '上海', tz: 'Asia/Shanghai', exch: 'SSE', sessions: [[570, 690], [780, 900]], lunch: true }, { city: '東京', tz: 'Asia/Tokyo', exch: 'TSE', sessions: [[540, 690], [750, 930]], lunch: true }, { city: 'シドニー', tz: 'Australia/Sydney', exch: 'ASX', sessions: [[600, 960]] },
  ];
  function localParts(timeZone) { var parts = new Intl.DateTimeFormat('ja-JP', { timeZone: timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', month: 'numeric', day: 'numeric' }).formatToParts(new Date()), out = {}; parts.forEach(function (part) { out[part.type] = part.value; }); var hour = Number(out.hour) % 24; return { hour: hour, minute: Number(out.minute), second: Number(out.second), minutes: hour * 60 + Number(out.minute), day: out.weekday, date: out.month + '月' + out.day + '日' }; }
  function sessionState(market, parts) { if (parts.day === '土' || parts.day === '日') return { text: '休場・週末', cls: 'session-closed' }; for (var i = 0; i < market.sessions.length; i++) { var session = market.sessions[i]; if (parts.minutes >= session[0] && parts.minutes < session[1]) { var left = session[1] - parts.minutes; return { text: '取引中・残り ' + Math.floor(left / 60) + '時間' + String(left % 60).padStart(2, '0') + '分', cls: 'session-open' }; } if (market.lunch && i + 1 < market.sessions.length && parts.minutes >= session[1] && parts.minutes < market.sessions[i + 1][0]) return { text: '昼休み', cls: 'session-lunch' }; } if (parts.minutes < market.sessions[0][0]) return { text: '取引前', cls: 'session-closed' }; return { text: '取引終了', cls: 'session-closed' }; }
  W.initClocks = function (root) { var grid = el('div', 'clock-grid'), cards = []; MARKETS.forEach(function (market) { var card = el('div', 'clock-card'), city = el('div', 'clock-city', market.city), time = el('div', 'clock-time', '--:--:--'), date = el('div', 'clock-date', market.exch), session = el('div', 'clock-session', '--'); card.append(city, time, date, session); grid.appendChild(card); cards.push({ market: market, time: time, date: date, session: session }); }); root.append(grid, el('div', 'panel-note', '通常取引時間のみ。祝日・短縮取引は未反映です。時刻は各取引所の現地時間です。')); W.updateClocks = function () { cards.forEach(function (card) { var part = localParts(card.market.tz), state = sessionState(card.market, part); card.time.textContent = String(part.hour).padStart(2, '0') + ':' + String(part.minute).padStart(2, '0') + ':' + String(part.second).padStart(2, '0'); card.date.textContent = part.day + ' ' + part.date + ' — ' + card.market.exch; card.session.textContent = state.text; card.session.className = 'clock-session ' + state.cls; card.time.style.color = state.cls === 'session-open' ? '' : '#4f8f68'; card.time.style.textShadow = state.cls === 'session-open' ? '' : 'none'; }); }; W.updateClocks(); setInterval(W.updateClocks, 1000); };
})(window.GMT);
