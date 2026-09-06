const API_BASE = 'https://api.coingecko.com/api/v3';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createCoinGeckoProvider() {
  return {
    id: 'COINGECKO_PUBLIC',
    // The public endpoint is an aggregated market reference. It is not an
    // execution feed and is intentionally refreshed at a modest cadence.
    minimumRefreshMs: 2 * 60 * 1000,
    supports(instrument) { return instrument.dataProvider === 'coingecko' && Boolean(instrument.coingeckoId); },
    async getQuotes(requestedInstruments) {
      if (!requestedInstruments.length) return new Map();
      const ids = [...new Set(requestedInstruments.map((item) => item.coingeckoId))];
      const url = new URL('simple/price', `${API_BASE}/`);
      url.searchParams.set('ids', ids.join(','));
      url.searchParams.set('vs_currencies', 'jpy');
      url.searchParams.set('include_24hr_change', 'true');
      url.searchParams.set('include_last_updated_at', 'true');
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'user-agent': 'global-market-terminal' } });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`provider_http_${response.status} ${body.slice(0, 160)}`);
      }
      const payload = await response.json();
      const results = new Map();
      requestedInstruments.forEach((instrument) => {
        const raw = payload?.[instrument.coingeckoId] || {};
        const price = finite(raw.jpy);
        const change = finite(raw.jpy_24h_change);
        if (price == null || price <= 0) return;
        results.set(instrument.id, {
          instrumentId: instrument.id,
          price,
          previousClose: change == null || change <= -99.9 ? null : price / (1 + change / 100),
          currency: 'JPY',
          asOf: raw.last_updated_at ? new Date(Number(raw.last_updated_at) * 1000).toISOString() : null,
          providerSymbol: instrument.displaySymbol || instrument.providerSymbol,
          status: 'DELAYED',
          deliveryLabel: 'COINGECKO PUBLIC — AGGREGATED REFERENCE',
        });
      });
      return results;
    },
    // CoinGecko publishes a daily price series, not exchange OHLC bars.  Keep
    // that distinction explicit so the UI can render it as a line reference.
    async getDailyBars(instrument, outputSize = 60) {
      const days = Math.min(365, Math.max(7, Math.ceil(outputSize * 1.8)));
      const url = new URL(`coins/${encodeURIComponent(instrument.coingeckoId)}/market_chart`, `${API_BASE}/`);
      url.searchParams.set('vs_currency', 'jpy');
      url.searchParams.set('days', String(days));
      url.searchParams.set('interval', 'daily');
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'user-agent': 'global-market-terminal' } });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`provider_http_${response.status} ${body.slice(0, 160)}`);
      }
      const payload = await response.json();
      const byDay = new Map();
      (Array.isArray(payload?.prices) ? payload.prices : []).forEach(([timestamp, value]) => {
        const price = finite(value);
        const day = new Date(Number(timestamp)).toISOString().slice(0, 10);
        if (price != null && price > 0) byDay.set(day, { time: day, close: price, closeOnly: true });
      });
      return [...byDay.values()].slice(-Math.max(2, outputSize));
    },
  };
}
