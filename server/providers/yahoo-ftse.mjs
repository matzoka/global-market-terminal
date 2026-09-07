// P1-FTSE: dedicated Yahoo Finance provider for the FTSE 100 index only.
//
// Why a dedicated provider (not an eodhd.mjs internal fallback):
//   market-service.mjs overwrites quote.provider with provider.id, so routing
//   FTSE through EODHD would mislabel provenance as EODHD_EOD. Yahoo ^FTSE is
//   keyless and must not depend on EODHD_API_TOKEN presence.
//
// Hard rule: this provider only ever returns the FTSE 100 INDEX itself.
// It must never substitute an ETF, futures contract, or any other instrument.
const API_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SYMBOL = '^FTSE';
const FTSE_ID = 'FTSE';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asIso(unixSecondsOrNull) {
  if (unixSecondsOrNull == null) return null;
  const ms = Number(unixSecondsOrNull) * 1000;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

async function requestChart() {
  const url = new URL(`${API_BASE}/${encodeURIComponent(SYMBOL)}`);
  url.searchParams.set('range', '7d');
  url.searchParams.set('interval', '1d');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('provider_empty_payload');
  return result;
}

function normaliseBars(result) {
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = number(closes[i]);
    if (price == null || price <= 0) continue;
    rows.push({ time: asIso(timestamps[i]).slice(0, 10), close: price, closeOnly: true });
  }
  return rows;
}

function statusFromMeta(meta) {
  // Yahoo keyless index data has no guaranteed realtime guarantee.
  // If a delay is explicitly reported, mark DELAYED; otherwise UNVERIFIED.
  if (meta?.dataDelay != null && Number(meta.dataDelay) > 0) return 'DELAYED';
  return 'UNVERIFIED';
}

export function createYahooFtseProvider() {
  return {
    id: 'YAHOO_FINANCE_FTSE',
    minimumRefreshMs: 24 * 60 * 60 * 1000,
    supports(instrument) { return instrument.id === FTSE_ID; },
    supportsDailyBars(instrument) { return instrument.id === FTSE_ID; },
    async getQuotes(requestedInstruments) {
      const instrument = requestedInstruments.find((item) => item.id === FTSE_ID);
      if (!instrument) return new Map();
      const result = await requestChart();
      const meta = result.meta || {};
      // Provenance guard: only the FTSE 100 INDEX qualifies.
      if (meta.instrumentType !== 'INDEX') {
        throw new Error(`unexpected_instrument_type_${meta.instrumentType || 'unknown'}`);
      }
      const price = number(meta.regularMarketPrice);
      if (price == null || price <= 0) throw new Error('provider_missing_price');
      const asOf = asIso(meta.regularMarketTime);
      if (!asOf) throw new Error('provider_missing_time');

      // Daily bars from the SAME Yahoo ^FTSE chart series.
      const bars = normaliseBars(result);
      // previousClose = the most recent bar whose date is strictly before the
      // current quote date. The current-day bar (if present and unconfirmed) is
      // never used as previousClose.
      const currentDay = asOf.slice(0, 10);
      const priorBars = bars.filter((bar) => bar.time < currentDay);
      const previous = priorBars.at(-1);
      const previousClose = previous?.close ?? null;
      const previousCloseAsOf = previous ? `${previous.time}T00:00:00.000Z` : null;

      const status = statusFromMeta(meta);
      return new Map([[
        FTSE_ID,
        {
          instrumentId: FTSE_ID,
          price,
          previousClose,
          previousCloseAsOf,
          currency: 'INDEX POINTS',
          asOf,
          providerSymbol: SYMBOL,
          status,
          deliveryLabel: 'YAHOO FINANCE — FTSE 100 INDEX',
          history: bars.map((bar) => bar.close),
        },
      ]]);
    },
    async getDailyBars() {
      // Note: the first FTSE bars fetch adds one external Yahoo request.
      // market-service caches bars for 15 minutes, so subsequent calls are cached.
      const result = await requestChart();
      const bars = normaliseBars(result);
      if (bars.length < 2) throw new Error('provider_insufficient_bars');
      return bars;
    },
  };
}
