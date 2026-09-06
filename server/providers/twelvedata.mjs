const API_BASE = 'https://api.twelvedata.com';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function request(path, params, apiKey) {
  const url = new URL(path, API_BASE);
  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const payload = await response.json();
  // Twelve Data may return an API error inside an otherwise successful HTTP
  // response. Treat that as a provider failure instead of silently showing
  // every FX pair as merely unavailable.
  if (payload?.status === 'error' || (Number.isInteger(Number(payload?.code)) && Number(payload.code) >= 400)) {
    throw new Error(payload.message || `provider_error_${payload.code || 'unknown'}`);
  }
  return payload;
}

function normaliseQuote(instrument, payload) {
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || raw.status === 'error') return null;
  const price = number(raw.close ?? raw.price);
  if (price == null || price <= 0) return null;
  return {
    instrumentId: instrument.id,
    price,
    previousClose: number(raw.previous_close),
    currency: raw.currency || 'USD',
    asOf: raw.timestamp ? new Date(Number(raw.timestamp) * 1000).toISOString() : null,
    providerSymbol: instrument.providerSymbol,
    status: instrument.researchGroup === 'fx' ? 'REALTIME' : 'UNVERIFIED',
    deliveryLabel: instrument.researchGroup === 'fx' ? 'TWELVE DATA — FOREX REFERENCE' : null,
  };
}

export function createTwelveDataProvider(apiKey, { fxOnly = false } = {}) {
  return {
    id: 'TWELVE_DATA',
    // Crypto is intentionally sourced from CoinGecko's aggregate reference
    // provider so that the terminal can state a single, honest provenance.
    supports(instrument) { return instrument.dataProvider !== 'coingecko' && (!fxOnly || instrument.researchGroup === 'fx'); },
    supportsDailyBars(instrument) { return !fxOnly && this.supports(instrument); },
    async getQuotes(requestedInstruments) {
      const result = new Map();
      // The endpoint accepts comma-separated symbols. Responses can be a keyed
      // object (batch) or a single quote; handle both forms without guessing.
      const payload = await request('/quote', { symbol: requestedInstruments.map((item) => item.providerSymbol).join(',') }, apiKey);
      for (const item of requestedInstruments) {
        const raw = payload?.[item.providerSymbol] ?? payload?.[item.id] ?? (requestedInstruments.length === 1 ? payload : null);
        const quote = normaliseQuote(item, raw);
        if (quote) result.set(item.id, quote);
      }
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      const payload = await request('/time_series', {
        symbol: instrument.providerSymbol,
        interval: '1day',
        outputsize: String(Math.min(500, Math.max(2, outputSize))),
      }, apiKey);
      const values = Array.isArray(payload?.values) ? payload.values : [];
      return values
        .map((row) => ({
          time: row.datetime,
          open: number(row.open), high: number(row.high), low: number(row.low), close: number(row.close), volume: number(row.volume),
        }))
        .filter((row) => row.open != null && row.high != null && row.low != null && row.close != null)
        .reverse();
    },
  };
}
