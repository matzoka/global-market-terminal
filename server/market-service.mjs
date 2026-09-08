import { config, primaryProviderReady } from './config.mjs';
import { instruments, byId, indexIds, metalIds, sectorIds, researchIds } from './instruments.mjs';
import { createAlpacaProvider } from './providers/alpaca.mjs';
import { createEodhdProvider } from './providers/eodhd.mjs';
import { createMetalsDevProvider } from './providers/metals-dev.mjs';
import { createTwelveDataProvider } from './providers/twelvedata.mjs';
import { createCoinGeckoProvider } from './providers/coingecko.mjs';
import { createFrankfurterProvider } from './providers/frankfurter.mjs';
import { createYahooFtseProvider } from './providers/yahoo-ftse.mjs';
import { createYahooMetalFuturesProvider } from './providers/yahoo-metal-futures.mjs';
import { createYahooIndexProvider } from './providers/yahoo-index.mjs';

let snapshots = new Map();
let bars = new Map();
let lastRefreshAt = 0;
const barRequests = new Map();
const barCacheMs = 15 * 60 * 1000;

const primaryProvider = !primaryProviderReady() ? null
  : config.provider === 'alpaca' ? createAlpacaProvider(config.alpacaApiKeyId, config.alpacaApiSecretKey)
  : createTwelveDataProvider(config.twelveDataApiKey);
const providers = [
  createCoinGeckoProvider(),
  primaryProvider,
  // When Alpaca remains the primary U.S. equity source, a configured Twelve
  // Data key can still cover the separate FX research universe.
  // Basic-plan credits are intentionally reserved for the five FX pairs;
  // the primary/equity, EOD index and metals providers retain their own
  // coverage instead of consuming the FX quota in one oversized batch.
  config.provider !== 'twelvedata' && config.twelveDataApiKey ? createTwelveDataProvider(config.twelveDataApiKey, { fxOnly: true }) : null,
  config.eodhdApiToken ? createEodhdProvider(config.eodhdApiToken) : null,
  config.metalsDevApiKey ? createMetalsDevProvider(config.metalsDevApiKey) : null,
  createFrankfurterProvider(),
  createYahooFtseProvider(),
  createYahooMetalFuturesProvider(),
  createYahooIndexProvider(),
].filter(Boolean);

function now() { return new Date().toISOString(); }
function qualityFor(id) {
  if (config.realtimeInstrumentIds.has(id)) return 'REALTIME';
  if (config.delayedInstrumentIds.has(id)) return 'DELAYED';
  if (config.eodInstrumentIds.has(id)) return 'EOD';
  return 'UNVERIFIED';
}
function providerFor(instrument) { return providers.find((candidate) => candidate.supports(instrument)) || null; }
function barsProviderFor(instrument) {
  return providers.find((candidate) => {
    if (typeof candidate.getDailyBars !== 'function') return false;
    return typeof candidate.supportsDailyBars === 'function' ? candidate.supportsDailyBars(instrument) : candidate.supports(instrument);
  }) || null;
}
function unavailable(instrument, reason) {
  const source = providerFor(instrument);
  return {
    instrumentId: instrument.id, status: 'UNAVAILABLE', provider: source?.id || 'COVERAGE_PENDING',
    providerSymbol: instrument.providerSymbol, deliveryLabel: 'NO APPROVED FREE SOURCE', asOf: null, receivedAt: now(), reason,
  };
}
function displayStatus(instrument, quote) { return quote.status || qualityFor(instrument.id); }

function primaryFreshEnough() { return Date.now() - lastRefreshAt < config.quoteCacheSeconds * 1000; }
function providerLastSuccess(provider) {
  return instruments.filter((item) => provider.supports(item)).reduce((latest, item) => {
    const quote = snapshots.get(item.id);
    if (quote?.provider !== provider.id) return latest;
    const timestamp = Date.parse(quote.fetchedAt || quote.receivedAt || '');
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
}
function providerDue(provider, force) {
  const minRefresh = provider.minimumRefreshMs || config.quoteCacheSeconds * 1000;
  const lastSuccess = providerLastSuccess(provider);
  // Manual refresh is deliberately unable to bypass EODHD/Metals.Dev quotas.
  if (provider === primaryProvider && force) return true;
  return !lastSuccess || Date.now() - lastSuccess >= minRefresh;
}
function retainOrMarkUnavailable(instrument, reason, receivedAt) {
  const previous = snapshots.get(instrument.id);
  if (previous?.price) snapshots.set(instrument.id, { ...previous, status: 'STALE', receivedAt, reason });
  else snapshots.set(instrument.id, unavailable(instrument, reason));
}

async function refreshQuotes(force = false) {
  if (!force && primaryFreshEnough()) return;
  lastRefreshAt = Date.now();
  let attempted = false;
  for (const provider of providers) {
    if (!providerDue(provider, force)) continue;
    attempted = true;
    const eligible = instruments.filter((item) => provider.supports(item));
    const receivedAt = now();
    try {
      const quotes = await provider.getQuotes(eligible);
      eligible.forEach((item) => {
        const quote = quotes.get(item.id);
        if (!quote) return retainOrMarkUnavailable(item, 'provider_returned_no_quote', receivedAt);
        snapshots.set(item.id, {
          ...quote, status: displayStatus(item, quote), provider: provider.id, receivedAt, fetchedAt: receivedAt,
          delaySeconds: quote.status === 'PARTIAL_REALTIME' ? 0 : null,
        });
      });
    } catch (error) {
      eligible.forEach((item) => retainOrMarkUnavailable(item, 'provider_request_failed', receivedAt));
      console.error(JSON.stringify({ event: 'quote_refresh_failed', provider: provider.id, at: receivedAt, message: error.message }));
    }
  }
  instruments.filter((item) => !providerFor(item)).forEach((item) => snapshots.set(item.id, unavailable(item, 'not_covered_by_configured_sources')));
}

export async function refreshAndInspect() {
  await refreshQuotes(false);
  const rows = instruments.map((item) => {
    const quote = snapshots.get(item.id) || unavailable(item, 'not_loaded');
    return {
      id: item.id,
      status: quote.status || 'UNKNOWN',
      reason: quote.reason || null,
      provider: quote.provider || null,
    };
  });
  return rows;
}

export async function dashboard(force = false) {
  await refreshQuotes(force);
  return {
    generatedAt: now(), provider: providers.map((provider) => provider.id).join(',') || 'NOT_CONFIGURED',
    quoteCacheSeconds: config.quoteCacheSeconds,
    instruments: instruments.map((item) => ({ ...item, quote: snapshots.get(item.id) || unavailable(item, 'not_loaded') })),
    groups: { indices: indexIds, sectors: sectorIds, metals: metalIds, research: researchIds, chart: 'ACWI' },
  };
}

export async function dailyBars(id, outputSize = 60) {
  const instrument = byId.get(id);
  if (!instrument) return null;
  const provider = barsProviderFor(instrument);
  if (!provider || typeof provider.getDailyBars !== 'function') return { instrumentId: id, provider: provider?.id || 'NOT_CONFIGURED', status: 'UNAVAILABLE', bars: [], reason: 'not_covered_by_configured_sources' };
  const requestedLimit = Math.min(500, Math.max(2, Number.parseInt(outputSize, 10) || 60));
  const previous = bars.get(id);
  const previousAge = Date.now() - Date.parse(previous?.receivedAt || '');
  if (previous?.bars?.length >= requestedLimit && Number.isFinite(previousAge) && previousAge < barCacheMs) return { ...previous, cacheAgeSeconds: Math.floor(previousAge / 1000) };
  if (barRequests.has(id)) return barRequests.get(id);
  const request = (async () => {
    try {
      const result = await provider.getDailyBars(instrument, requestedLimit);
      const status = provider.id === 'ALPACA_IEX' ? 'PARTIAL_REALTIME' : provider.id === 'COINGECKO_PUBLIC' ? 'DELAYED' : provider.id === 'FRANKFURTER_ECB' ? 'EOD' : provider.id === 'YAHOO_FINANCE_FTSE' ? 'UNVERIFIED' : provider.id === 'YAHOO_FINANCE_METAL_FUTURES' ? 'UNVERIFIED' : provider.id === 'YAHOO_FINANCE_INDEX' ? 'UNVERIFIED' : qualityFor(id);
      const deliveryLabel = provider.id === 'ALPACA_IEX' ? 'IEX DAILY BARS — SINGLE U.S. EXCHANGE' : provider.id === 'COINGECKO_PUBLIC' ? 'COINGECKO DAILY PRICE — AGGREGATED REFERENCE' : provider.id === 'FRANKFURTER_ECB' ? 'FRANKFURTER — ECB DAILY REFERENCE' : provider.id === 'YAHOO_FINANCE_FTSE' ? 'YAHOO FINANCE — FTSE 100 INDEX' : provider.id === 'YAHOO_FINANCE_METAL_FUTURES' ? 'YAHOO FINANCE — METAL FUTURES REFERENCE' : provider.id === 'YAHOO_FINANCE_INDEX' ? 'YAHOO FINANCE — INDEX REFERENCE' : null;
      const response = { instrumentId: id, provider: provider.id, status, deliveryLabel, receivedAt: now(), requestedLimit, bars: result };
      bars.set(id, response);
      return response;
    } catch (error) {
      if (previous?.bars?.length) return { ...previous, status: 'STALE', receivedAt: now(), reason: 'provider_request_failed' };
      return { instrumentId: id, provider: provider.id, status: 'UNAVAILABLE', bars: [], receivedAt: now(), reason: 'provider_request_failed' };
    } finally { barRequests.delete(id); }
  })();
  barRequests.set(id, request);
  return request;
}

export function health() {
  const sourceList = providers.map((provider) => provider.id);
  let unavailableCount = 0;
  let staleCount = 0;
  for (const item of instruments) {
    const quote = snapshots.get(item.id);
    // Only count instruments we have actually evaluated. Instruments whose
    // quote has not been fetched yet (cold/separate instance) are unknown,
    // not unavailable — counting them would over-report incidents.
    if (!quote) continue;
    if (quote.status === 'UNAVAILABLE') unavailableCount++;
    else if (quote.status === 'STALE') staleCount++;
  }
  return {
    status: sourceList.length ? 'ready' : 'configuration_required', provider: sourceList.join(',') || 'NOT_CONFIGURED',
    providerConfigured: sourceList.length > 0, quoteCacheSeconds: config.quoteCacheSeconds,
    instrumentCount: instruments.length, unavailableCount, staleCount,
    degraded: unavailableCount > 0 || staleCount > 0,
    freeCoverage: 'World reference: ACWI ETF / EOD indices; FX: Twelve Data quote + ECB daily reference; crypto: CoinGecko aggregated reference; metals: quota-cached spot reference',
  };
}
