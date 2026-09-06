// Crypto quotes via Coinbase public spot-price API (keyless).
// CoinGecko's public API blocks Cloudflare Workers shared egress IPs, so we use
// Coinbase's keyless public endpoint for JPY-denominated spot prices. The
// provider id is kept for compatibility with instrument definitions.
const SPOT_BASE = 'https://api.coinbase.com/v2/prices';
const CANDLES_BASE = 'https://api.exchange.coinbase.com/products';

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
        const url = `${SPOT_BASE}/${symbol}-JPY/spot`;
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
      const url = new URL(`${CANDLES_BASE}/${symbol}-JPY/candles`);
      url.searchParams.set('granularity', '86400');
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'user-agent': 'global-market-terminal' } });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      // Coinbase returns [timestamp, low, high, open, close, volume] newest-first.
      return (Array.isArray(payload) ? payload : [])
        .map(([timestamp, , , , close]) => {
          const price = finite(close);
          const day = new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
          return { time: day, close: price, closeOnly: true };
        })
        .filter((row) => row.close != null && row.close > 0)
        .reverse()
        .slice(-Math.max(2, outputSize));
    },
  };
}
