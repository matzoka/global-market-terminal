const API_BASE = 'https://eodhd.com/api';

// Yahoo Finance index symbols (keyless fallback for daily bars when the EODHD
// token is missing or the upstream call fails).
const YAHOO_INDEX = Object.freeze({
  SPX: '^GSPC', NDX: '^NDX', DJI: '^DJI', DAX: '^GDAXI', N225: '^N225', HSI: '^HSI',
});

// Verified against EODHD's INDX symbol list on 2026-08-15. FTSE 100 did not
// resolve to the underlying index in that list, so it is deliberately omitted.
const INDEX_SYMBOLS = Object.freeze({
  SPX: 'GSPC.INDX', NDX: 'NDX.INDX', DJI: 'DJI.INDX', SX5E: 'SX5E.INDX',
  DAX: 'GDAXI.INDX', N225: 'N225.INDX', HSI: 'HSI.INDX',
  SSE: 'SSEC.INDX', ASX: 'AXJO.INDX',
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  return `${value}T00:00:00.000Z`;
}

async function request(path, params, token) {
  const url = new URL(path, `${API_BASE}/`);
  Object.entries({ ...params, api_token: token, fmt: 'json' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  return response.json();
}

function normaliseBars(raw) {
  return (Array.isArray(raw) ? raw : []).map((bar) => ({
    time: String(bar.date || ''), open: number(bar.open), high: number(bar.high), low: number(bar.low),
    close: number(bar.close), volume: number(bar.volume),
  })).filter((bar) => bar.time && bar.open != null && bar.high != null && bar.low != null && bar.close != null).slice(-60);
}

export function createEodhdProvider(token) {
  return {
    id: 'EODHD_EOD',
    minimumRefreshMs: 24 * 60 * 60 * 1000,
    supports(instrument) { return instrument.kind === 'index' && Boolean(INDEX_SYMBOLS[instrument.id]); },
    supportsDailyBars(instrument) { return this.supports(instrument); },
    async getQuotes(requestedInstruments) {
      const from = new Date();
      from.setUTCDate(from.getUTCDate() - 130);
      const result = new Map();
      for (const instrument of requestedInstruments) {
        const symbol = INDEX_SYMBOLS[instrument.id];
        if (!symbol) continue;
        const raw = await request(`eod/${encodeURIComponent(symbol)}`, { from: from.toISOString().slice(0, 10), order: 'a' }, token);
        const historyBars = normaliseBars(raw);
        const latest = historyBars.at(-1);
        const previous = historyBars.at(-2);
        if (!latest) continue;
        result.set(instrument.id, {
          instrumentId: instrument.id, price: latest.close, previousClose: previous?.close ?? null,
          currency: 'INDEX POINTS', asOf: isoDate(latest.time), providerSymbol: symbol,
          status: 'EOD', deliveryLabel: 'EODHD — EOD INDICATIVE REFERENCE',
          history: historyBars.map((bar) => bar.close),
        });
      }
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      const symbol = INDEX_SYMBOLS[instrument.id];
      if (!symbol) return [];
      const from = new Date();
      from.setUTCDate(from.getUTCDate() - Math.max(130, outputSize * 3));
      try {
        const raw = await request(`eod/${encodeURIComponent(symbol)}`, { from: from.toISOString().slice(0, 10), order: 'a' }, token);
        const bars = normaliseBars(raw).slice(-Math.max(2, outputSize));
        if (bars.length >= 2) return bars;
      } catch {
        // fall through to Yahoo Finance keyless fallback
      }
      const ySymbol = YAHOO_INDEX[instrument.id];
      if (!ySymbol) return [];
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}`);
      url.searchParams.set('range', '6mo');
      url.searchParams.set('interval', '1d');
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      const timestamps = payload?.chart?.result?.[0]?.timestamp || [];
      const closes = payload?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const rows = [];
      for (let i = 0; i < timestamps.length; i++) {
        const price = number(closes[i]);
        if (price == null || price <= 0) continue;
        rows.push({ time: new Date(Number(timestamps[i]) * 1000).toISOString().slice(0, 10), close: price, closeOnly: true });
      }
      return rows.slice(-Math.max(2, outputSize));
    },
  };
}
