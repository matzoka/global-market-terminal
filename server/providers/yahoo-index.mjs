// P2-INDEX Phase A: dedicated Yahoo Finance provider for major stock indices.
//
// Why a dedicated provider (not an eodhd.mjs internal fallback):
//   market-service.mjs refreshes registered providers in order and overwrites
//   quote.provider with provider.id. If these indices stayed in EODHD_EOD, a
//   successful Yahoo fetch would be followed by an EODHD 403 that flips the
//   quote back to STALE/UNAVAILABLE. Giving YAHOO_FINANCE_INDEX sole ownership
//   of these eight indices avoids the cross-provider refresh race.
//
// Hard rule: this provider ONLY returns the underlying INDEX itself. ETFs,
// mutual funds, futures, or any non-INDEX substitute are rejected.
const API_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const INDEX_SYMBOL = Object.freeze({
  SPX: '^GSPC',   // S&P 500
  NDX: '^NDX',    // NASDAQ-100
  DJI: '^DJI',    // Dow Jones Industrial Average
  DAX: '^GDAXI',  // DAX 40
  N225: '^N225',  // Nikkei 225
  HSI: '^HSI',    // Hang Seng
  ASX: '^AXJO',   // S&P/ASX 200
  SSE: '000001.SS', // SSE Composite (^SSE is NOT the composite; use 000001.SS)
  SX5E: '^STOXX50E', // Euro Stoxx 50 (Yahoo index; ^SX5E/STOXX50E.F are not the index)
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asIso(unixSecondsOrNull) {
  if (unixSecondsOrNull == null) return null;
  const ms = Number(unixSecondsOrNull) * 1000;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// Per-symbol short-lived chart memo (same-instance only; no cross-instance
// guarantee). Avoids a duplicate Yahoo chart fetch when getDailyBars() is called
// shortly after getQuotes() for the same symbol. Stale memo is never treated as
// fresh and is never used to fabricate data on provider failure.
const CHART_MEMO_MS = 15 * 60 * 1000;

async function requestChart(chartMemo, symbol, { allowMemo = true } = {}) {
  if (allowMemo) {
    const memo = chartMemo.get(symbol);
    if (memo && Date.now() - memo.fetchedAt < CHART_MEMO_MS) return memo.chart;
  }
  const url = new URL(`${API_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', '3mo');
  url.searchParams.set('interval', '1d');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('provider_empty_payload');
  chartMemo.set(symbol, { chart: result, fetchedAt: Date.now() });
  return result;
}

function normaliseBars(result, symbol) {
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = number(closes[i]);
    if (price == null) continue;
    rows.push({ time: asIso(timestamps[i]).slice(0, 10), close: price, closeOnly: true, providerSymbol: symbol });
  }
  return rows;
}

function statusFromMeta(meta) {
  if (meta?.dataDelay != null && Number(meta.dataDelay) > 0) return 'DELAYED';
  return 'UNVERIFIED';
}

export function createYahooIndexProvider() {
  const chartMemo = new Map(); // symbol -> { chart, fetchedAt }
  return {
    id: 'YAHOO_FINANCE_INDEX',
    minimumRefreshMs: 30 * 60 * 1000,
    supports(instrument) { return instrument.kind === 'index' && Boolean(INDEX_SYMBOL[instrument.id]); },
    supportsDailyBars(instrument) { return instrument.kind === 'index' && Boolean(INDEX_SYMBOL[instrument.id]); },
    async getQuotes(requestedInstruments) {
      const result = new Map();
      for (const instrument of requestedInstruments) {
        const symbol = INDEX_SYMBOL[instrument.id];
        if (!symbol) continue;
        const chart = await requestChart(chartMemo, symbol);
        const meta = chart.meta || {};
        // Provenance guard: only the INDEX instrument itself qualifies.
        if (meta.instrumentType !== 'INDEX') {
          throw new Error(`unexpected_instrument_type_${meta.instrumentType || 'unknown'}`);
        }
        const price = number(meta.regularMarketPrice);
        if (price == null) throw new Error('provider_missing_price');
        const asOf = asIso(meta.regularMarketTime);
        if (!asOf) throw new Error('provider_missing_time');

        // Daily bars from the SAME Yahoo symbol series.
        const bars = normaliseBars(chart, symbol);
        // previousClose = the most recent bar whose date is strictly before the
        // current quote date. The current-day bar (if unconfirmed) is never used.
        const currentDay = asOf.slice(0, 10);
        const priorBars = bars.filter((bar) => bar.time < currentDay);
        const previous = priorBars.at(-1);
        const previousClose = previous?.close ?? null;
        const previousCloseAsOf = previous ? `${previous.time}T00:00:00.000Z` : null;

        const status = statusFromMeta(meta);
        result.set(instrument.id, {
          instrumentId: instrument.id,
          price,
          previousClose,
          previousCloseAsOf,
          currency: 'INDEX POINTS',
          asOf,
          providerSymbol: symbol,
          status,
          deliveryLabel: 'YAHOO FINANCE — INDEX REFERENCE',
          history: bars.map((bar) => bar.close),
        });
      }
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      const symbol = INDEX_SYMBOL[instrument.id];
      if (!symbol) return [];
      const result = await requestChart(chartMemo, symbol);
      const bars = normaliseBars(result, symbol);
      if (bars.length < 2) throw new Error('provider_insufficient_bars');
      return bars.slice(-Math.max(2, outputSize));
    },
  };
}
