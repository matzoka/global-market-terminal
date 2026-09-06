const API_BASE = 'https://api.frankfurter.dev/v2/';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function createFrankfurterProvider() {
  return {
    id: 'FRANKFURTER_ECB',
    // History only: Twelve Data remains the quote source while ECB closes
    // provide an auditable, keyless daily series for small charts.
    supports() { return false; },
    supportsDailyBars(instrument) { return instrument.researchGroup === 'fx' && /^([A-Z]{3})\/([A-Z]{3})$/.test(instrument.providerSymbol || ''); },
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
      return (Array.isArray(payload) ? payload : []).map((row) => ({ time: String(row.date || ''), close: number(row.rate), closeOnly: true }))
        .filter((row) => row.time && row.close != null).slice(-Math.max(2, outputSize));
    },
  };
}
