/*
  Deliberately manual, read-only preflight for a newly acquired market-data key.
  It checks every configured dashboard symbol before the key is used in a
  production deployment. It does not print the key or store a quote response.
*/
import { config, primaryProviderReady } from '../server/config.mjs';
import { instruments } from '../server/instruments.mjs';
import { createAlpacaProvider } from '../server/providers/alpaca.mjs';
import { createEodhdProvider } from '../server/providers/eodhd.mjs';
import { createMetalsDevProvider } from '../server/providers/metals-dev.mjs';
import { createTwelveDataProvider } from '../server/providers/twelvedata.mjs';

const primary = !primaryProviderReady() ? null : config.provider === 'alpaca'
  ? createAlpacaProvider(config.alpacaApiKeyId, config.alpacaApiSecretKey)
  : createTwelveDataProvider(config.twelveDataApiKey);
const providers = [primary, config.eodhdApiToken ? createEodhdProvider(config.eodhdApiToken) : null, config.metalsDevApiKey ? createMetalsDevProvider(config.metalsDevApiKey) : null].filter(Boolean);

if (!providers.length) {
  console.error('MARKET DATA PROVIDER IS NOT CONFIGURED. Add the approved provider credentials to .env first.');
  process.exitCode = 2;
} else {
  try {
    const providerResults = [];
    for (const provider of providers) {
      const covered = instruments.filter((item) => provider.supports(item));
      const quotes = await provider.getQuotes(covered);
      const unresolved = covered.filter((item) => !quotes.has(item.id)).map((item) => item.id);
      providerResults.push({ provider: provider.id, covered: covered.map((item) => item.id), resolved: covered.length - unresolved.length, unresolved });
    }
    const alpaca = providers.find((provider) => provider.id === 'ALPACA_IEX');
    const bars = alpaca ? await alpaca.getDailyBars(instruments.find((item) => item.id === 'AAPL'), 60) : [];
    const unresolved = providerResults.flatMap((result) => result.unresolved);
    console.log(JSON.stringify({
      providers: providerResults,
      checkedAt: new Date().toISOString(),
      quoteCoverage: { resolved: providerResults.reduce((total, result) => total + result.resolved, 0), unresolved: unresolved.length },
      intentionallyNotCovered: instruments.filter((item) => !providers.some((provider) => provider.supports(item))).map((item) => item.id),
      aaplDailyBars: bars.length,
    }, null, 2));
    if (unresolved.length || (alpaca && bars.length < 2)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ providers: providers.map((provider) => provider.id), error: 'provider_preflight_failed', message: error.message }));
    process.exitCode = 1;
  }
}
