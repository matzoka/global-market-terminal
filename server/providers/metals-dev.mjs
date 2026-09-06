const API_BASE = 'https://api.metals.dev/v1';
const METALS = Object.freeze({ XAU: 'gold', XAG: 'silver', XPT: 'platinum', XPD: 'palladium' });

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asIso(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createMetalsDevProvider(apiKey) {
  return {
    id: 'METALS_DEV_SPOT',
    // The provider's upstream is fast, but its free tier is 100 requests/month.
    // One batch supplies all four cards; three batches/day stays below 100/month.
    minimumRefreshMs: 8 * 60 * 60 * 1000,
    supports(instrument) { return instrument.kind === 'metal' && Boolean(METALS[instrument.id]); },
    async getQuotes(requestedInstruments) {
      if (!requestedInstruments.length) return new Map();
      const url = new URL('latest', `${API_BASE}/`);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('currency', 'USD');
      url.searchParams.set('unit', 'toz');
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      if (payload?.status !== 'success') throw new Error('provider_invalid_payload');
      const result = new Map();
      requestedInstruments.forEach((instrument) => {
        const price = number(payload.metals?.[METALS[instrument.id]]);
        if (price == null) return;
        result.set(instrument.id, {
          instrumentId: instrument.id, price, previousClose: null, currency: 'USD', asOf: asIso(payload.timestamp),
          providerSymbol: instrument.displaySymbol || instrument.providerSymbol, status: 'DELAYED',
          deliveryLabel: 'METALS.DEV — SPOT REFERENCE, FREE-QUOTA CACHED',
        });
      });
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      const ySymbol = { XAU: 'GC=F', XAG: 'SI=F', XPT: 'PL=F', XPD: 'PA=F' }[instrument.id];
      if (!ySymbol) return [];
      // Daily reference series for metals is sourced from Yahoo Finance (keyless);
      // Metals.dev free tier has no time-series endpoint.
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ySymbol}`);
      url.searchParams.set('range', '3mo');
      url.searchParams.set('interval', '1d');
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      const timestamps = payload?.chart?.result?.[0]?.timestamp || [];
      const closes = payload?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const rows = [];
      for (let i = 0; i < timestamps.length; i++) {
        const price = Number(closes[i]);
        if (!Number.isFinite(price) || price <= 0) continue;
        rows.push({ time: new Date(Number(timestamps[i]) * 1000).toISOString().slice(0, 10), close: price, closeOnly: true });
      }
      return rows.slice(-Math.max(2, outputSize));
    },
  };
}
