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
    // Spot quotes are acquired ONLY by the Cron path (refreshMetalsSpot) with a
    // 12h KV cooldown, NOT by the dashboard/manual-refresh loop. minimumRefreshMs
    // here is informational; the binding cooldown lives in market-service.mjs.
    minimumRefreshMs: 12 * 60 * 60 * 1000,
    supports(instrument) { return instrument.kind === 'metal' && Boolean(METALS[instrument.id]); },
    // Metal daily bars are sourced from Yahoo Finance futures via the dedicated
    // YAHOO_FINANCE_METAL_FUTURES provider, so this spot provider must NOT claim
    // daily-bar support (prevents provenance from being mislabeled as spot).
    supportsDailyBars() { return false; },
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
  };
}
