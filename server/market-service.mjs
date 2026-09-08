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
let metalsKv = null;
const METALS_SPOT_KEY = 'metals_dev_spot';
// Metals.Dev Free tier = 100 requests/month. Acquisition is Cron-only with a
// 12h cooldown so the WHOLE account (all isolates) targets ~60-62 req/month,
// leaving generous headroom. NOTE: Workers KV is eventually consistent and is NOT
// a strict distributed lock, so this is a target, not a hard guarantee.
const METALS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

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
  createFrankfurterProvider(),
  createYahooFtseProvider(),
  createYahooMetalFuturesProvider(),
  createYahooIndexProvider(),
].filter(Boolean);
// Metals.Dev spot is acquired ONLY via refreshMetalsSpot() on the Cron path and
// served from KV on the dashboard path. It is intentionally excluded from the
// live refreshQuotes() provider loop so dashboard traffic cannot consume quota.
const metalsDevProvider = config.metalsDevApiKey ? createMetalsDevProvider(config.metalsDevApiKey) : null;
const metalInstruments = () => (metalsDevProvider ? instruments.filter((item) => metalsDevProvider.supports(item)) : []);

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
  const source = providerFor(instrument) || (metalsDevProvider && metalsDevProvider.supports(instrument) ? metalsDevProvider : null);
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
// Read the cached Metals.Dev spot snapshot from KV (dashboard path — no upstream call).
async function loadMetalsSpotCache() {
  if (!metalsKv) return null;
  try {
    const raw = await metalsKv.get(METALS_SPOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
// Persist the latest Metals.Dev spot snapshot (success OR failure) to KV.
async function saveMetalsSpotCache(record) {
  if (!metalsKv) return;
  try { await metalsKv.put(METALS_SPOT_KEY, JSON.stringify(record)); } catch { /* best-effort */ }
}

// Cron-only Metals.Dev spot acquisition. Respects a 12h cooldown read from KV so
// every Worker isolate shares the SAME last-attempt gate (no retry storm while
// quota is exhausted). Saves success quotes + fetchedAt, and on failure the
// attemptedAt + reason, so dashboard reads a stable cached state either way.
export async function refreshMetalsSpot(kv = null) {
  if (kv) metalsKv = kv;
  if (!metalsDevProvider) return null;
  const cache = await loadMetalsSpotCache();
  if (cache?.attemptedAt && Date.now() - Date.parse(cache.attemptedAt) < METALS_COOLDOWN_MS) {
    return cache; // cooldown not elapsed — do not call upstream, suppress retries
  }
  const eligible = metalInstruments();
  const receivedAt = now();
  try {
    const quotes = await metalsDevProvider.getQuotes(eligible);
    const quotesMap = new Map();
    eligible.forEach((item) => {
      const quote = quotes.get(item.id);
      if (quote) quotesMap.set(item.id, { ...quote, status: displayStatus(item, quote), provider: metalsDevProvider.id, receivedAt, fetchedAt: receivedAt, delaySeconds: null });
    });
    const record = { attemptedAt: receivedAt, status: 'OK', quotes: Object.fromEntries(quotesMap) };
    await saveMetalsSpotCache(record);
    return record;
  } catch (error) {
    // Persist the failure (with reason) and the cooldown so we do NOT retry hard
    // while quota is exhausted (error 1203) — protects the remaining monthly budget.
    const record = { attemptedAt: receivedAt, status: 'FAILED', reason: error.message };
    await saveMetalsSpotCache(record);
    console.error(JSON.stringify({ event: 'metals_spot_refresh_failed', at: receivedAt, message: error.message }));
    return record;
  }
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

export async function refreshAndInspect(kv = null) {
  if (kv) metalsKv = kv;
  await refreshQuotes(false);
  // Surface the Cron-acquired Metals.Dev spot snapshot (from KV) for alert evaluation.
  const metalsCache = await loadMetalsSpotCache();
  const rows = instruments.map((item) => {
    let quote = snapshots.get(item.id);
    if (!quote && metalsDevProvider?.supports(item) && metalsCache) {
      quote = metalsCache.status === 'OK'
        ? (metalsCache.quotes?.[item.id] || unavailable(item, 'metals_spot_cache_empty'))
        : unavailable(item, metalsCache.reason || 'metals_spot_unavailable');
    }
    quote = quote || unavailable(item, 'not_loaded');
    return {
      id: item.id,
      status: quote.status || 'UNKNOWN',
      reason: quote.reason || null,
      provider: quote.provider || null,
    };
  });
  return rows;
}

export async function dashboard(force = false, kv = null) {
  if (kv) metalsKv = kv;
  await refreshQuotes(force);
  // Metals.Dev spot is served from the Cron-written KV cache; dashboard traffic
  // NEVER triggers an upstream call (quota guard). Successful cache -> quotes;
  // failed/expired cache -> UNAVAILABLE with the stored reason.
  const metalsCache = await loadMetalsSpotCache();
  const instrumentsOut = instruments.map((item) => {
    if (metalsDevProvider?.supports(item) && metalsCache) {
      if (metalsCache.status === 'OK') {
        return { ...item, quote: metalsCache.quotes?.[item.id] || unavailable(item, 'metals_spot_cache_empty') };
      }
      return { ...item, quote: unavailable(item, metalsCache.reason || 'metals_spot_unavailable') };
    }
    return { ...item, quote: snapshots.get(item.id) || unavailable(item, 'not_loaded') };
  });
  return {
    generatedAt: now(), provider: providers.map((provider) => provider.id).join(',') || 'NOT_CONFIGURED',
    quoteCacheSeconds: config.quoteCacheSeconds,
    instruments: instrumentsOut,
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

export async function health(kv = null) {
  if (kv) metalsKv = kv;
  const sourceList = providers.map((provider) => provider.id);
  let unavailableCount = 0;
  let staleCount = 0;
  for (const item of instruments) {
    // Metals.Dev spot lives in KV (Cron-written) and is checked separately below,
    // independent of whether the provider object is currently configured.
    if (item.kind === 'metal') continue;
    const quote = snapshots.get(item.id);
    // Only count instruments we have actually evaluated. Instruments whose
    // quote has not been fetched yet (cold/separate instance) are unknown,
    // not unavailable — counting them would over-report incidents.
    if (!quote) continue;
    if (quote.status === 'UNAVAILABLE') unavailableCount++;
    else if (quote.status === 'STALE') staleCount++;
  }
  // Account for Metals.Dev spot via its KV cache (no upstream call here).
  // Count metals regardless of whether the provider object is currently wired,
  // as long as the instrument registry defines metal cards.
  const metalCards = instruments.filter((item) => item.kind === 'metal');
  if (metalCards.length) {
    const cache = await loadMetalsSpotCache();
    for (const item of metalCards) {
      if (!cache) { unavailableCount++; continue; }
      if (cache.status === 'OK') {
        if (!cache.quotes?.[item.id]) unavailableCount++;
      } else {
        unavailableCount++; // FAILED / quota-exhausted -> unavailable
      }
    }
  }
  return {
    status: sourceList.length ? 'ready' : 'configuration_required', provider: sourceList.join(',') || 'NOT_CONFIGURED',
    providerConfigured: sourceList.length > 0, quoteCacheSeconds: config.quoteCacheSeconds,
    instrumentCount: instruments.length, unavailableCount, staleCount,
    degraded: unavailableCount > 0 || staleCount > 0,
    freeCoverage: 'World reference: ACWI ETF / EOD indices; FX: Twelve Data quote + ECB daily reference; crypto: CoinGecko aggregated reference; metals: quota-cached spot reference',
  };
}
