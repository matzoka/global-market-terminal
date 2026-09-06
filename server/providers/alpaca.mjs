const API_BASE = 'https://data.alpaca.markets';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function request(path, params, credentials) {
  const url = new URL(path, API_BASE);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': credentials.keyId,
      'APCA-API-SECRET-KEY': credentials.secretKey,
    },
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  return response.json();
}

function normaliseQuote(instrument, raw) {
  const trade = raw?.latestTrade;
  const daily = raw?.dailyBar;
  const previous = raw?.prevDailyBar;
  const price = number(trade?.p ?? daily?.c);
  const dailyClose = number(daily?.c);
  const dailyVolume = number(daily?.v);
  if (price == null || price <= 0) return null;
  return {
    instrumentId: instrument.id,
    price,
    previousClose: number(previous?.c),
    currency: 'USD',
    asOf: asIso(trade?.t ?? daily?.t),
    providerSymbol: instrument.alpacaSymbol,
    status: 'PARTIAL_REALTIME',
    deliveryLabel: 'IEX — SINGLE U.S. EXCHANGE',
    // A current, reproducible area metric for the heatmap. It deliberately
    // uses the daily IEX bar rather than pretending that we have market cap.
    areaMetric: dailyClose != null && dailyClose > 0 && dailyVolume != null && dailyVolume > 0 ? 'IEX_DOLLAR_VOLUME' : null,
    areaValue: dailyClose != null && dailyClose > 0 && dailyVolume != null && dailyVolume > 0 ? dailyClose * dailyVolume : null,
    areaAsOf: asIso(daily?.t),
  };
}

export function createAlpacaProvider(keyId, secretKey) {
  const credentials = { keyId, secretKey };
  return {
    id: 'ALPACA_IEX',
    supports(instrument) { return Boolean(instrument.alpacaSymbol); },
    async getQuotes(requestedInstruments) {
      if (!requestedInstruments.length) return new Map();
      const payload = await request('/v2/stocks/snapshots', {
        symbols: requestedInstruments.map((item) => item.alpacaSymbol).join(','),
        feed: 'iex',
      }, credentials);
      const result = new Map();
      requestedInstruments.forEach((item) => {
        const quote = normaliseQuote(item, payload?.[item.alpacaSymbol]);
        if (quote) result.set(item.id, quote);
      });
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      if (!instrument.alpacaSymbol) return [];
      // Alpaca's bars endpoint otherwise defaults to the current trading day.
      // On weekends or holidays that correctly returns no bar, but it is not a
      // useful 60-session chart. Request enough calendar time for the target
      // number of sessions without inventing any missing candles.
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - Math.max(45, outputSize * 3));
      const payload = await request(`/v2/stocks/${encodeURIComponent(instrument.alpacaSymbol)}/bars`, {
        timeframe: '1Day',
        limit: String(Math.min(500, Math.max(2, outputSize))),
        adjustment: 'raw',
        feed: 'iex',
        start: start.toISOString(),
        end: end.toISOString(),
        sort: 'desc',
      }, credentials);
      return (Array.isArray(payload?.bars) ? payload.bars : [])
        .map((bar) => ({
          time: asIso(bar.t)?.slice(0, 10) || null,
          open: number(bar.o), high: number(bar.h), low: number(bar.l), close: number(bar.c), volume: number(bar.v),
        }))
        .filter((bar) => bar.time && bar.open != null && bar.high != null && bar.low != null && bar.close != null)
        .reverse();
    },
  };
}
