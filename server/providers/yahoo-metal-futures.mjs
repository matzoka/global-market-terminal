// P1-CHG-METAL: dedicated Yahoo Finance provider for metal FUTURES daily bars only.
//
// Why a dedicated provider (not an eodhd.mjs-style internal fallback):
//   market-service.mjs overwrites quote.provider AND bar responses' provider with
//   provider.id. If Yahoo futures bars stayed inside METALS_DEV_SPOT, the bar
//   provenance would be mislabeled as the spot provider. Keeping futures bars in
//   their own provider makes the separation explicit and audit-friendly.
//
// Hard rule: this provider ONLY supplies daily bars for metal futures. It must
// never be used for quote routing (METALS_DEV_SPOT keeps that role), and it must
// only ever accept Yahoo FUTURE-type instruments — never an ETF, spot, or index.
const API_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FUTURE_SYMBOL = Object.freeze({
  XAU: 'GC=F', // COMEX Gold futures
  XAG: 'SI=F', // COMEX Silver futures
  XPT: 'PL=F', // NYMEX Platinum futures
  XPD: 'PA=F', // NYMEX Palladium futures
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

async function requestChart(symbol) {
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
  return result;
}

function normaliseBars(result, symbol) {
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = number(closes[i]);
    if (price == null) continue;
    // providerSymbol is the ACTUAL Yahoo futures symbol this provider used,
    // so the detail view can show it instead of a guessed value.
    rows.push({ time: asIso(timestamps[i]).slice(0, 10), close: price, closeOnly: true, providerSymbol: symbol });
  }
  return rows;
}

export function createYahooMetalFuturesProvider() {
  return {
    id: 'YAHOO_FINANCE_METAL_FUTURES',
    minimumRefreshMs: 15 * 60 * 1000,
    // Quote routing stays with METALS_DEV_SPOT.
    supports() { return false; },
    supportsDailyBars(instrument) { return instrument.kind === 'metal' && Boolean(FUTURE_SYMBOL[instrument.id]); },
    async getQuotes() { return new Map(); },
    async getDailyBars(instrument, outputSize = 60) {
      const symbol = FUTURE_SYMBOL[instrument.id];
      if (!symbol) return [];
      const result = await requestChart(symbol);
      // Provenance guard: only FUTURE-type instruments qualify.
      if (result.meta?.instrumentType !== 'FUTURE') {
        throw new Error(`unexpected_instrument_type_${result.meta?.instrumentType || 'unknown'}`);
      }
      const bars = normaliseBars(result, symbol);
      if (bars.length < 2) throw new Error('provider_insufficient_bars');
      return bars.slice(-Math.max(2, outputSize));
    },
  };
}
