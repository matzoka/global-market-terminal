const API_BASE = 'https://eodhd.com/api';

// Yahoo Finance index symbols are now owned by the dedicated YAHOO_FINANCE_INDEX
// provider (P2-INDEX Phase A + P2-INDEX-SX5E). EODHD no longer claims any index
// for quote or bars; SX5E moved to YAHOO_FINANCE_INDEX (^STOXX50E) as well.

// All nine indices (SPX, NDX, DJI, DAX, N225, HSI, ASX, SSE, SX5E) are now owned
// by YAHOO_FINANCE_INDEX. EODHD_EOD retains no index symbols; this map is kept
// empty so supports()/supportsDailyBars() return false for all indices.
const INDEX_SYMBOLS = Object.freeze({});

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
        // EODHD index coverage is limited (SX5E only after Phase A); on failure
        // return empty so market-service can mark STALE/UNAVAILABLE without a
        // cross-provider fallback that would mislabel provenance.
      }
      return [];
    },
  };
}
