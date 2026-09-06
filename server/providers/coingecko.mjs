// Crypto quotes via Coinbase public spot-price API (keyless).
// CoinGecko's public API blocks Cloudflare Workers shared egress IPs, so we use
// Coinbase's keyless public endpoint for JPY-denominated spot prices. The
// provider id is kept for compatibility with instrument definitions.
const API_BASE = 'https://api.coinbase.com/v2/prices';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createCoinGeckoProvider() {
  return {
    id: 'COINGECKO_PUBLIC',
    minimumRefreshMs: 2 * 60 * 1000,
    supports(instrument) { return instrument.dataProvider === 'coingecko' && Boolean(instrument.coingeckoId); },
    // Map our coingeckoId (e.g. "bitcoin") to the Coinbase product symbol (BTC).
    symbolFor(instrument) {
      const map = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP' };
      return map[instrument.coingeckoId] || null;
    },
    async getQuotes(requestedInstruments) {
      const result = new Map();
      await Promise.all(requestedInstruments.map(async (instrument) => {
        const symbol = this.symbolFor(instrument);
        if (!symbol) return;
        const url = `${API_BASE}/${symbol}-JPY/spot`;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'user-agent': 'global-market-terminal' } });
          if (!response.ok) return;
          const payload = await response.json();
          const price = finite(payload?.data?.amount);
          if (price == null || price <= 0) return;
          result.set(instrument.id, {
            instrumentId: instrument.id,
            price,
            previousClose: null,
            currency: 'JPY',
            asOf: new Date().toISOString(),
            providerSymbol: instrument.displaySymbol || instrument.providerSymbol,
            status: 'DELAYED',
            deliveryLabel: 'COINBASE PUBLIC — AGGREGATED REFERENCE',
          });
        } catch { /* skip individual failures */ }
      }));
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      const symbol = this.symbolFor(instrument);
      if (!symbol) return [];
      // Yahoo Finance public chart API (keyless) provides JPY-denominated daily
      // candles that Cloudflare Workers egress can reach (Coinbase candles 404,
      // CoinGecko is IP-blocked on Workers).
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}-JPY`);
      url.searchParams.set('range', '3mo');
      url.searchParams.set('interval', '1d');
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      const timestamps = payload?.chart?.result?.[0]?.timestamp || [];
      const closes = payload?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const rows = [];
      for (let i = 0; i < timestamps.length; i++) {
        const price = finite(closes[i]);
        if (price == null || price <= 0) continue;
        const day = new Date(Number(timestamps[i]) * 1000).toISOString().slice(0, 10);
        rows.push({ time: day, close: price, closeOnly: true });
      }
      return rows.slice(-Math.max(2, outputSize));
    },
  };
}
