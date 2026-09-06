const API_BASE = 'https://api.frankfurter.dev/v1/';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function createFrankfurterProvider() {
  return {
    id: 'FRANKFURTER_ECB',
    // ECB reference rates, keyless. Used for FX spot quotes (latest ECB rate)
    // and as an auditable daily series for small FX charts.
    supports(instrument) { return instrument.researchGroup === 'fx' && /^([A-Z]{3})\/([A-Z]{3})$/.test(instrument.providerSymbol || ''); },
    supportsDailyBars(instrument) { return instrument.researchGroup === 'fx' && /^([A-Z]{3})\/([A-Z]{3})$/.test(instrument.providerSymbol || ''); },
    async getQuotes(requestedInstruments) {
      const result = new Map();
      // Batch by base currency to minimise requests (ECB publishes all quotes for a base at once).
      const byBase = new Map();
      for (const item of requestedInstruments) {
        const [base] = item.providerSymbol.split('/');
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(item);
      }
      for (const [base, items] of byBase) {
        const quotes = [...new Set(items.map((item) => item.providerSymbol.split('/')[1]))];
        const url = new URL('latest', API_BASE);
        url.searchParams.set('base', base);
        url.searchParams.set('symbols', quotes.join(','));
        const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`provider_http_${response.status}`);
        const payload = await response.json();
        const rateDate = payload.date || null;
        const asOf = rateDate ? new Date(`${rateDate}T16:00:00Z`).toISOString() : null;
        for (const item of items) {
          const quote = item.providerSymbol.split('/')[1];
          const rate = number(payload?.rates?.[quote]);
          if (rate == null || rate <= 0) continue;
          result.set(item.id, {
            instrumentId: item.id,
            price: rate,
            previousClose: null,
            currency: quote,
            asOf,
            providerSymbol: item.providerSymbol,
            status: 'EOD',
            deliveryLabel: 'FRANKFURTER — ECB DAILY REFERENCE',
          });
        }
      }
      return result;
    },
    async getDailyBars(instrument, outputSize = 60) {
      const [base, quote] = instrument.providerSymbol.split('/');
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - Math.max(14, outputSize * 2));
      const url = new URL('rates', API_BASE);
      url.searchParams.set('base', base);
      url.searchParams.set('quotes', quote);
      url.searchParams.set('from', start.toISOString().slice(0, 10));
      url.searchParams.set('to', end.toISOString().slice(0, 10));
      url.searchParams.set('providers', 'ECB');
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      return (Array.isArray(payload) ? payload : [])
        .map((row) => ({ time: String(row.date || ''), close: number(row.rate), closeOnly: true }))
        .filter((row) => row.time && row.close != null).slice(-Math.max(2, outputSize));
    },
  };
}
