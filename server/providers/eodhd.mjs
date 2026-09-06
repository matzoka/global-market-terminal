const API_BASE = 'https://eodhd.com/api';

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
  };
}
